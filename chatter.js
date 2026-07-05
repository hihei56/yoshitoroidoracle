// chatter.js — 1時間無発言時のチャット賑やかし自動投稿
const axios = require('axios');
const { pickOneLurker } = require('./lurker_picker');
const { getSettings } = require('./config');

const SILENCE_MS       = 60 * 60 * 1000;      // 1時間
const COOLDOWN_MS      = 2  * 60 * 60 * 1000; // 投稿後2時間クールダウン
const CHECK_INTERVAL_MS = 5 * 60 * 1000;      // 5分ごとチェック

const webhookCache = new Map();
let lastMessageTime = Date.now(); // 起動時は「今」扱い
let lastPostedTime  = 0;
let _lastLurkerId   = null;

function recordMessage(channelId) {
    const settings  = getSettings();
    const targetId  = settings.chatterChannelId ?? settings.lurkerChannelId;
    if (targetId && channelId === targetId) lastMessageTime = Date.now();
}

async function getWebhook(channel, client) {
    if (webhookCache.has(channel.id)) return webhookCache.get(channel.id);
    const hooks = await channel.fetchWebhooks();
    let wh = hooks.find(h => h.owner?.id === client.user.id && h.token);
    if (!wh) wh = await channel.createWebhook({ name: 'ChatterBot' });
    webhookCache.set(channel.id, wh);
    return wh;
}

const SLEEPY_FALLBACK = ['眠い…😴', 'ねむねむ…💤', 'うとうと🥱', 'zzz…😪', '眠くなってきた🌙'];

async function generateSleepyContent() {
    try {
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            max_tokens: 30,
            messages: [
                {
                    role: 'system',
                    content:
                        'Discordのチャンネルがしばらく静かなときに、雑談botとして眠気を表す短い一言を生成してください。' +
                        '「眠い」「ねむ」「うとうと」「zzz」など眠気を表す単語を1つ含め、絵文字（😴💤🥱😪など）を1〜2個添えてください。' +
                        '10文字程度、メンションなし、本文だけ返してください。',
                },
            ],
        }, {
            headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
            timeout: 8000,
        });
        return res.data.choices[0].message.content.trim();
    } catch (e) {
        console.warn('[Chatter] AI生成失敗、フォールバック:', e.message);
        return SLEEPY_FALLBACK[Math.floor(Math.random() * SLEEPY_FALLBACK.length)];
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

    const content = await generateSleepyContent();
    if (!content) return;

    const { member: lurker } = await pickOneLurker(guild, { lastPickedId: _lastLurkerId });
    if (!lurker) return;
    _lastLurkerId = lurker.id;

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
