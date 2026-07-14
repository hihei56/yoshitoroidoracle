// chatter.js — 1時間無発言時のチャット賑やかし自動投稿
const axios = require('axios');
const { pickOneLurker } = require('./lurker_picker');
const { getPersona, setPersona, pickPersonality, pickCriticPersonality } = require('./chatter_persona');
const { getSettings } = require('./config');
const { checkNgWords, normalizeForDetection } = require('./moderator');
const { registerChatterMessage } = require('./chatter_registry');

const SILENCE_MS       = 60 * 60 * 1000;      // 1時間
const COOLDOWN_MS      = 2  * 60 * 60 * 1000; // 投稿後2時間クールダウン
const CHECK_INTERVAL_MS = 5 * 60 * 1000;      // 5分ごとチェック
const CONTEXT_FETCH_LIMIT = 10;               // AI生成に渡す直近メッセージ数

// ラリー（固定人格の投稿にほかのlurkerが連鎖して反応する掛け合い）設定
const RALLY_CHANCE       = 0.6;               // 最初の投稿後にラリーへ発展する確率
const RALLY_MIN_TURNS    = 1;
const RALLY_MAX_TURNS    = 3;
const RALLY_DELAY_MIN_MS = 8_000;
const RALLY_DELAY_MAX_MS = 25_000;

const webhookCache = new Map();
let lastMessageTime = Date.now(); // 起動時は「今」扱い
let lastPostedTime  = 0;

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomRallyDelay() {
    return RALLY_DELAY_MIN_MS + Math.random() * (RALLY_DELAY_MAX_MS - RALLY_DELAY_MIN_MS);
}

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
const DEFAULT_GROQ_MODEL = 'qwen/qwen3-32b';

function buildChatterMessages(context, personaName, { personality, isReply = false, contrarian = false } = {}) {
    const personaLine = personality
        ? `あなたは「${personaName}」というDiscordサーバーの一般メンバーです。性格: ${personality}`
        : `あなたは「${personaName}」というDiscordサーバーの一般メンバーです。`;
    const situation = isReply
        ? '友達同士の雑談チャンネルで、直前の発言にふと相槌や反応を返すところです。'
        : '友達同士の雑談チャンネルで、しばらく会話が途切れた後にふと一言つぶやくところです。';
    const tone = contrarian
        ? 'みんなが同じ空気で盛り上がっていても、素直に全肯定はせず、ちょっと斜めから一言ツッコミや冷めた視点を入れてください。ただし人を傷つける攻撃的な言い方や暴言は避け、あくまで軽い皮肉・茶化し程度に留めてください。'
        : '角が立つ言い方や煽り・否定的な言葉は避け、あたたかく居心地の良い空気になるようにしてください。';
    return [
        {
            role: 'system',
            content: `${personaLine} ${situation}直近の会話の流れを踏まえて、くだけた自然な日本語で短い一言（1文、30文字以内目安）を返してください。質問でも独り言でも構いません。${tone}絵文字は基本的に付けず、文章の最後に毎回絵文字を付けるような機械的なパターンは絶対に避けてください（普通の人はそんなに毎回絵文字を使いません）。発言内容だけを返し、説明や前置きは付けないでください。`,
        },
        {
            role: 'user',
            content: context ? `直近の会話:\n${context}` : '（しばらく誰も発言していません）',
        },
    ];
}

async function generateViaGroq(context, personaName, model, opts) {
    if (!process.env.GROQ_API_KEY) return null;
    try {
        const body = {
            model,
            max_tokens: 60,
            temperature: 0.9,
            messages: buildChatterMessages(context, personaName, opts),
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

async function generateViaCloudflare(context, personaName, model, opts) {
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
                messages: buildChatterMessages(context, personaName, opts),
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

async function generateChatMessage(context, personaName, opts) {
    const settings = getSettings();
    if (settings.chatterAiProvider === 'cloudflare') {
        return generateViaCloudflare(context, personaName, settings.chatterAiModel || DEFAULT_CF_MODEL, opts);
    }
    return generateViaGroq(context, personaName, settings.chatterAiModel || DEFAULT_GROQ_MODEL, opts);
}

async function ensurePersona(guild) {
    let persona = await getPersona(guild, 'main');
    if (persona) return persona;

    const { member } = await pickOneLurker(guild, {});
    if (!member) return null;
    const personality = pickPersonality();
    setPersona(member.id, personality, 'main');
    return { lurkerId: member.id, personality, member };
}

// 全肯定ムードに水を差す「批評家」役。メイン人格とは別のlurkerを1人固定して使い回す
async function ensureCriticPersona(guild, excludeId) {
    let persona = await getPersona(guild, 'critic');
    if (persona) return persona;

    const { member } = await pickOneLurker(guild, { lastPickedId: excludeId });
    if (!member) return null;
    const personality = pickCriticPersonality();
    setPersona(member.id, personality, 'critic');
    return { lurkerId: member.id, personality, member };
}

async function sendChatterLine(client, channel, name, avatarURL, content) {
    const targetChannel = channel.isThread?.() ? channel.parent : channel;
    const webhook = await getWebhook(targetChannel, client);
    return webhook.send({
        content,
        username: name,
        avatarURL,
        allowedMentions: { parse: [] },
        ...(channel.isThread?.() && { threadId: channel.id }),
    });
}

// 固定人格の投稿をきっかけに、ほかのlurkerがランダムな回数だけ連鎖して反応する「ラリー」
// 全肯定だけで終わらないよう、必ず1回は批評家役が交ざって水を差す
async function runRally(client, guild, channel, baseContext, history, excludeId) {
    const turns  = RALLY_MIN_TURNS + Math.floor(Math.random() * (RALLY_MAX_TURNS - RALLY_MIN_TURNS + 1));
    const critic = await ensureCriticPersona(guild, excludeId);
    const criticTurn = critic ? Math.floor(Math.random() * turns) : -1;
    let lastSpeakerId = excludeId;

    for (let i = 0; i < turns; i++) {
        await wait(randomRallyDelay());

        const useCritic = i === criticTurn && critic.member.id !== lastSpeakerId;
        const picked    = useCritic ? critic.member : (await pickOneLurker(guild, { lastPickedId: lastSpeakerId })).member;
        if (!picked) return;

        const rallyContext = `${baseContext ? baseContext + '\n' : ''}${history.map(h => `${h.name}: ${h.content}`).join('\n')}`;
        const name = picked.displayName || picked.user.username;
        const content = await generateChatMessage(rallyContext, name, useCritic
            ? { isReply: true, personality: critic.personality, contrarian: true }
            : { isReply: true });
        if (!content) return; // 生成できなければラリーを打ち切る

        const { hit } = checkNgWords(normalizeForDetection(content));
        if (hit) return;

        const sent = await sendChatterLine(client, channel, name, picked.user.displayAvatarURL({ dynamic: true }), content);
        registerChatterMessage(sent.id, picked.id);
        console.log(`[Chatter] 🔁 ラリー "${content}" | なりすまし: ${name}${useCritic ? '（批評家役）' : ''}`);

        history.push({ name, content });
        lastSpeakerId = picked.id;
        lastMessageTime = Date.now(); // ラリー継続中も無発言タイマーをリセット
    }
}

async function generateAndPost(client, guild, channel) {
    const persona = await ensurePersona(guild);
    if (!persona) return { ok: false, reason: 'なりすまし対象のlurkerが見つかりませんでした。' };
    const personaName = persona.member.displayName || persona.member.user.username;

    const context = await fetchRecentContext(channel);
    let content = await generateChatMessage(context, personaName, { personality: persona.personality });
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

    const sent = await sendChatterLine(client, channel, personaName, persona.member.user.displayAvatarURL({ dynamic: true }), content);
    registerChatterMessage(sent.id, persona.member.id);

    console.log(`[Chatter] ✅ "${content}" | なりすまし: ${personaName} | source: ${source}`);

    if (source === 'AI' && Math.random() < RALLY_CHANCE) {
        runRally(client, guild, channel, context, [{ name: personaName, content }], persona.member.id)
            .catch(e => console.error('[Chatter] ラリーエラー:', e.message));
    }

    return { ok: true, content, source, lurkerName: personaName };
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
