// chatter.js — 1時間無発言時のチャット賑やかし自動投稿
const axios = require('axios');
const { pickOneLurker } = require('./lurker_picker');
const { getSettings } = require('./config');
const { checkNgWords, normalizeForDetection } = require('./moderator');
const { registerChatterMessage } = require('./chatter_registry');

const SILENCE_MS       = 60 * 60 * 1000;      // 1時間
const COOLDOWN_MS      = 2  * 60 * 60 * 1000; // 投稿後2時間クールダウン
const CHECK_INTERVAL_MS = 5 * 60 * 1000;      // 5分ごとチェック
const CONTEXT_FETCH_LIMIT = 10;               // AI生成に渡す直近メッセージ数

const webhookCache = new Map();
let lastMessageTime = Date.now(); // 起動時は「今」扱い
let lastPostedTime  = 0;
let _lastLurkerId   = null;

function recordMessage(channelId) {
    const settings  = getSettings();
    const targetId  = settings.chatterChannelId ?? settings.lurkerChannelId;
    if (!targetId || channelId !== targetId) return;
    lastMessageTime = Date.now();
}

async function getWebhook(channel, client) {
    if (webhookCache.has(channel.id)) return webhookCache.get(channel.id);
    const hooks = await channel.fetchWebhooks();
    let wh = hooks.find(h => h.owner?.id === client.user.id && h.token);
    if (!wh) wh = await channel.createWebhook({ name: 'ChatterBot' });
    webhookCache.set(channel.id, wh);
    return wh;
}

function buildEmojiContent(guild) {
    const emojis = [...guild.emojis.cache.values()].filter(e => e.available);
    if (!emojis.length) return null;
    const count = Math.random() < 0.5 ? 1 : Math.floor(Math.random() * 2) + 2; // 1 or 2〜3
    const result = [];
    for (let i = 0; i < count; i++) {
        result.push(emojis[Math.floor(Math.random() * emojis.length)].toString());
    }
    return result.join('');
}

async function fetchRecentContext(channel) {
    try {
        const messages = await channel.messages.fetch({ limit: CONTEXT_FETCH_LIMIT });
        return [...messages.values()]
            .filter(m => !m.author.bot && m.content?.trim())
            .reverse()
            .map(m => `${m.member?.displayName || m.author.username}: ${m.content.slice(0, 200)}`)
            .join('\n');
    } catch (e) {
        console.error('[Chatter] コンテキスト取得エラー:', e.message);
        return '';
    }
}

const DEFAULT_CF_MODEL   = '@cf/meta/llama-3.1-8b-instruct-fast';
const DEFAULT_GROQ_MODEL = 'moonshotai/kimi-k2-instruct';

function buildChatterMessages(context, personaName) {
    return [
        {
            role: 'system',
            content: `あなたは「${personaName}」というDiscordサーバーの一般メンバーです。友達同士の雑談チャンネルで、しばらく会話が途切れた後にふと一言つぶやくところです。直近の会話の流れを踏まえて、くだけた自然な日本語で短い一言（1文、30文字以内目安）を返してください。質問でも独り言でも構いません。絵文字は基本的に付けず、文章の最後に毎回絵文字を付けるような機械的なパターンは絶対に避けてください（普通の人はそんなに毎回絵文字を使いません）。発言内容だけを返し、説明や前置きは付けないでください。`,
        },
        {
            role: 'user',
            content: context ? `直近の会話:\n${context}` : '（しばらく誰も発言していません）',
        },
    ];
}

async function generateViaGroq(context, personaName, model) {
    if (!process.env.GROQ_API_KEY) return null;
    try {
        const body = {
            model,
            max_tokens: 60,
            temperature: 0.9,
            messages: buildChatterMessages(context, personaName),
        };
        // Qwen3系のみ：思考モードを無効化（雑談一言生成に余計なトークンは不要）
        if (model.startsWith('qwen/')) body.reasoning_effort = 'none';

        const res = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            body,
            {
                headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
                timeout: 15_000,
            }
        );
        return res.data.choices[0]?.message?.content?.trim() || null;
    } catch (e) {
        console.error(`[Chatter] Groq生成エラー(model=${model}):`, e.message);
        return null;
    }
}

async function generateViaCloudflare(context, personaName, model) {
    const accountId = process.env.CF_ACCOUNT_ID;
    const apiToken  = process.env.CF_API_TOKEN;
    if (!accountId || !apiToken) {
        console.error('[Chatter] Cloudflare AI: CF_ACCOUNT_ID/CF_API_TOKENが未設定です');
        return null;
    }
    try {
        const res = await axios.post(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
            {
                max_tokens: 60,
                temperature: 0.9,
                messages: buildChatterMessages(context, personaName),
            },
            {
                headers: { Authorization: `Bearer ${apiToken}` },
                timeout: 15_000,
            }
        );
        return res.data?.result?.response?.trim() || null;
    } catch (e) {
        console.error(`[Chatter] Cloudflare AI生成エラー(model=${model}):`, e.message);
        return null;
    }
}

async function generateChatMessage(context, personaName) {
    const settings = getSettings();
    if (settings.chatterAiProvider === 'cloudflare') {
        return generateViaCloudflare(context, personaName, settings.chatterAiModel || DEFAULT_CF_MODEL);
    }
    return generateViaGroq(context, personaName, settings.chatterAiModel || DEFAULT_GROQ_MODEL);
}

async function generateAndPost(client, guild, channel) {
    const { member: lurker } = await pickOneLurker(guild, { lastPickedId: _lastLurkerId });
    if (!lurker) return { ok: false, reason: 'なりすまし対象のlurkerが見つかりませんでした。' };
    _lastLurkerId = lurker.id;

    const context = await fetchRecentContext(channel);
    let content = await generateChatMessage(context, lurker.displayName || lurker.user.username);
    let source  = content ? 'AI' : null;

    if (content) {
        const { hit } = checkNgWords(normalizeForDetection(content));
        if (hit) {
            console.warn(`[Chatter] ${source}生成文がNGワードに抵触したため絵文字にフォールバック`);
            content = null;
            source = null;
        }
    }
    if (!content) {
        content = buildEmojiContent(guild);
        source  = content ? '絵文字' : null;
    }
    if (!content) return { ok: false, reason: '生成できる内容がありませんでした（サーバーに絵文字がない等）。' };

    const targetChannel = channel.isThread?.() ? channel.parent : channel;
    const webhook = await getWebhook(targetChannel, client);

    const sent = await webhook.send({
        content,
        username:        lurker.displayName || lurker.user.username,
        avatarURL:       lurker.user.displayAvatarURL({ dynamic: true }),
        allowedMentions: { parse: [] },
        ...(channel.isThread?.() && { threadId: channel.id }),
    });
    registerChatterMessage(sent.id, lurker.id);

    console.log(`[Chatter] ✅ "${content}" | 成りすまし: ${lurker.displayName} | source: ${source}`);
    return { ok: true, content, source, lurkerName: lurker.displayName || lurker.user.username };
}

async function tryPost(client) {
    const settings  = getSettings();
    const channelId = settings.chatterChannelId ?? settings.lurkerChannelId;
    if (!channelId) return;

    const now = Date.now();
    if (now - lastMessageTime < SILENCE_MS) return;
    if (now - lastPostedTime  < COOLDOWN_MS) return;

    const guild = client.guilds.cache.first();
    if (!guild) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const result = await generateAndPost(client, guild, channel);
    if (result.ok) {
        lastPostedTime  = Date.now();
        lastMessageTime = Date.now(); // 自分の投稿でリセット（連投防止）
    }
}

// /admin chatter からの試し打ち用。沈黙・クールダウン判定を無視し、コマンド実行チャンネルに即投稿する
async function forcePost(interaction) {
    return generateAndPost(interaction.client, interaction.guild, interaction.channel);
}

function initChatter(client) {
    setInterval(() => {
        tryPost(client).catch(e => console.error('[Chatter] エラー:', e.message));
    }, CHECK_INTERVAL_MS);
    console.log('[Chatter] ✅ 初期化 | 1時間無発言で自動投稿');
}

function getLastMessageTime() {
    return lastMessageTime;
}

module.exports = { initChatter, recordMessage, forcePost, getLastMessageTime };
