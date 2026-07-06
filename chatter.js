// chatter.js — 1時間無発言時のチャット賑やかし自動投稿
const axios = require('axios');
const { pickOneLurker } = require('./lurker_picker');
const { getSettings } = require('./config');
const { checkNgWords, normalizeForDetection } = require('./moderator');
const { recordForCorpus, generate: generateMarkovMessage } = require('./markov_chatter');

const SILENCE_MS       = 60 * 60 * 1000;      // 1時間
const COOLDOWN_MS      = 2  * 60 * 60 * 1000; // 投稿後2時間クールダウン
const CHECK_INTERVAL_MS = 5 * 60 * 1000;      // 5分ごとチェック
const CONTEXT_FETCH_LIMIT = 10;               // AI生成に渡す直近メッセージ数

const webhookCache = new Map();
let lastMessageTime = Date.now(); // 起動時は「今」扱い
let lastPostedTime  = 0;
let _lastLurkerId   = null;

function recordMessage(channelId, content, authorId) {
    const settings  = getSettings();
    const targetId  = settings.chatterChannelId ?? settings.lurkerChannelId;
    if (!targetId || channelId !== targetId) return;
    lastMessageTime = Date.now();
    if (authorId && (settings.markovExcludedUsers ?? []).includes(authorId)) return;
    recordForCorpus(content).catch(e => console.error('[Chatter] コーパス記録エラー:', e.message));
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

async function generateChatMessage(context, personaName) {
    if (!process.env.GROQ_API_KEY) return null;
    try {
        const res = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'qwen/qwen3-32b',
                max_tokens: 60,
                temperature: 0.9,
                reasoning_effort: 'none', // Qwen3の思考モードを無効化（雑談一言生成に余計なトークンは不要）
                messages: [
                    {
                        role: 'system',
                        content: `あなたは「${personaName}」というDiscordサーバーの一般メンバーです。友達同士の雑談チャンネルで、しばらく会話が途切れた後にふと一言つぶやくところです。直近の会話の流れを踏まえて、くだけた自然な日本語で短い一言（1文、絵文字を使っても良い、30文字以内目安）を返してください。質問でも独り言でも構いません。発言内容だけを返し、説明や前置きは付けないでください。`,
                    },
                    {
                        role: 'user',
                        content: context ? `直近の会話:\n${context}` : '（しばらく誰も発言していません）',
                    },
                ],
            },
            {
                headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
                timeout: 15_000,
            }
        );
        return res.data.choices[0]?.message?.content?.trim() || null;
    } catch (e) {
        console.error('[Chatter] AI生成エラー:', e.message);
        return null;
    }
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

    const { member: lurker } = await pickOneLurker(guild, { lastPickedId: _lastLurkerId });
    if (!lurker) return;
    _lastLurkerId = lurker.id;

    let content = generateMarkovMessage();
    let source  = content ? 'Markov' : null;

    if (!content) {
        const context = await fetchRecentContext(channel);
        content = await generateChatMessage(context, lurker.displayName || lurker.user.username);
        if (content) source = 'AI';
    }

    if (content) {
        const { hit } = checkNgWords(normalizeForDetection(content));
        if (hit) {
            console.warn(`[Chatter] ${source}生成文がNGワードに抵触したため絵文字にフォールバック`);
            content = null;
        }
    }
    if (!content) content = buildEmojiContent(guild);
    if (!content) return;

    const targetChannel = channel.isThread?.() ? channel.parent : channel;
    const webhook = await getWebhook(targetChannel, client);

    await webhook.send({
        content,
        username:        lurker.displayName || lurker.user.username,
        avatarURL:       lurker.user.displayAvatarURL({ dynamic: true }),
        allowedMentions: { parse: [] },
        ...(channel.isThread?.() && { threadId: channel.id }),
    });

    lastPostedTime  = Date.now();
    lastMessageTime = Date.now(); // 自分の投稿でリセット（連投防止）
    console.log(`[Chatter] ✅ "${content}" | 成りすまし: ${lurker.displayName}`);
}

function initChatter(client) {
    setInterval(() => {
        tryPost(client).catch(e => console.error('[Chatter] エラー:', e.message));
    }, CHECK_INTERVAL_MS);
    console.log('[Chatter] ✅ 初期化 | 1時間無発言で自動投稿');
}

module.exports = { initChatter, recordMessage };
