// chatter.js — 1時間無発言時のチャット賑やかし自動投稿
const axios = require('axios');
const { pickOneLurker, pickMultipleLurkers } = require('./lurker_picker');
const { getSettings } = require('./config');
const { checkNgWords, normalizeForDetection } = require('./moderator');
const { registerChatterMessage } = require('./chatter_registry');

const SILENCE_MS       = 60 * 60 * 1000;      // 1時間
const COOLDOWN_MS      = 2  * 60 * 60 * 1000; // 投稿後2時間クールダウン
const CHECK_INTERVAL_MS = 5 * 60 * 1000;      // 5分ごとチェック
const CONTEXT_FETCH_LIMIT = 10;               // AI生成に渡す直近メッセージ数

// ── 複数人会話（exchange）関連の設定 ──
const EXCHANGE_SILENCE_MS        = 3  * 60 * 60 * 1000; // 3時間無発言でトリガー候補
const EXCHANGE_COOLDOWN_MS       = 12 * 60 * 60 * 1000; // 投稿後12時間クールダウン
const EXCHANGE_CHECK_INTERVAL_MS = 10 * 60 * 1000;      // 10分ごとチェック
const EXCHANGE_MIN_PARTICIPANTS  = 2;
const EXCHANGE_MAX_PARTICIPANTS  = 4;
const EXCHANGE_MIN_TURNS         = 3;
const EXCHANGE_MAX_TURNS         = 6;
const EXCHANGE_MIN_DELAY_MS      = 4_000;  // 発言間隔の最小
const EXCHANGE_MAX_DELAY_MS      = 14_000; // 発言間隔の最大

const webhookCache = new Map();
let lastMessageTime = Date.now(); // 起動時は「今」扱い（単発chatter用。exchange投稿でも更新される）
let lastPostedTime  = 0;
let _lastLurkerId   = null;

// exchangeは単発chatter自身の投稿では沈黙判定をリセットしない
// （lastMessageTimeを共有すると単発chatterのクールダウン周期に埋もれてトリガーしなくなるため、
//   人間の実発言だけを見る独立したタイマーを持つ）
let lastHumanMessageTime   = Date.now();
let lastExchangePostedTime = 0;

function recordMessage(channelId) {
    const settings  = getSettings();
    const targetId  = settings.chatterChannelId ?? settings.lurkerChannelId;
    if (!targetId || channelId !== targetId) return;
    lastMessageTime      = Date.now();
    lastHumanMessageTime = Date.now();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

async function callGroq(systemPrompt, userContent) {
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
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent },
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

async function generateChatMessage(context, personaName) {
    const systemPrompt = `あなたは「${personaName}」というDiscordサーバーの一般メンバーです。友達同士の雑談チャンネルで、しばらく会話が途切れた後にふと一言つぶやくところです。直近の会話の流れを踏まえて、くだけた自然な日本語で短い一言（1文、30文字以内目安）を返してください。質問でも独り言でも構いません。絵文字は基本的に付けず、文章の最後に毎回絵文字を付けるような機械的なパターンは絶対に避けてください（普通の人はそんなに毎回絵文字を使いません）。発言内容だけを返し、説明や前置きは付けないでください。`;
    return callGroq(systemPrompt, context ? `直近の会話:\n${context}` : '（しばらく誰も発言していません）');
}

// ── 複数人会話（exchange）用の一言生成 ──
// 同じ生成ロジック・同じ「一般メンバーの雑談」人格を使い回し、話者の名前だけ差し替える
function buildExchangeSystemPrompt(personaName, otherNames) {
    const othersText = otherNames.length ? otherNames.join('、') : '他のメンバー';
    return `あなたは「${personaName}」というDiscordサーバーの一般メンバーです。今、${othersText}と一緒に雑談チャンネルで軽い世間話をしています。チャンネルの直近の流れと、これまでのやりとりを踏まえて、あなたの発言として自然な一言（1文、30文字以内目安）だけを返してください。相槌・ツッコミ・話題への反応・ふとした話題転換など何でも構いません。絵文字は基本的に付けず、毎回絵文字を付けるような機械的なパターンは避けてください。同じ言い回しの繰り返しも避けてください。発言内容だけを返し、話者名や説明、前置きは付けないでください。`;
}

async function generateExchangeLine(channelContext, exchangeSoFar, personaName, otherNames) {
    const systemPrompt = buildExchangeSystemPrompt(personaName, otherNames);
    const parts = [];
    if (channelContext) parts.push(`チャンネルの直近の会話:\n${channelContext}`);
    parts.push(exchangeSoFar
        ? `これまでのやりとり:\n${exchangeSoFar}`
        : '（まだ誰も話し始めていません。あなたが最初の一言を切り出してください）');
    return callGroq(systemPrompt, parts.join('\n\n'));
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

// ── 複数人会話（exchange）本体 ──
// 同一のchatter人格・生成ロジックを使い回しつつ、複数のlurkerのなりすまし（webhook）で
// 数往復のやりとりを演出する。参加人数・往復数は毎回ランダム。
async function generateExchangeAndPost(client, guild, channel) {
    const participantCount = EXCHANGE_MIN_PARTICIPANTS
        + Math.floor(Math.random() * (EXCHANGE_MAX_PARTICIPANTS - EXCHANGE_MIN_PARTICIPANTS + 1));
    const turnCount = EXCHANGE_MIN_TURNS
        + Math.floor(Math.random() * (EXCHANGE_MAX_TURNS - EXCHANGE_MIN_TURNS + 1));

    const participants = await pickMultipleLurkers(guild, participantCount);
    if (participants.length < 2) {
        return { ok: false, reason: '会話に必要な人数のなりすまし対象が見つかりませんでした。' };
    }

    const channelContext = await fetchRecentContext(channel);
    const targetChannel  = channel.isThread?.() ? channel.parent : channel;
    const webhook        = await getWebhook(targetChannel, client);

    const turns = [];
    let lastSpeakerIdx = -1;

    for (let i = 0; i < turnCount; i++) {
        let idx;
        do {
            idx = Math.floor(Math.random() * participants.length);
        } while (idx === lastSpeakerIdx);
        lastSpeakerIdx = idx;

        const speaker      = participants[idx];
        const speakerName  = speaker.displayName || speaker.user.username;
        const otherNames   = participants
            .filter((_, j) => j !== idx)
            .map(m => m.displayName || m.user.username);
        const exchangeSoFar = turns.map(t => `${t.name}: ${t.content}`).join('\n');

        let content = await generateExchangeLine(channelContext, exchangeSoFar, speakerName, otherNames);
        if (content) {
            const { hit } = checkNgWords(normalizeForDetection(content));
            if (hit) {
                console.warn('[Chatter/Exchange] 生成文がNGワードに抵触したためこのターンをスキップ');
                content = null;
            }
        }
        if (!content) continue; // 無理に埋めず、そのターンは飛ばす

        if (turns.length > 0) {
            const delay = EXCHANGE_MIN_DELAY_MS
                + Math.floor(Math.random() * (EXCHANGE_MAX_DELAY_MS - EXCHANGE_MIN_DELAY_MS));
            await sleep(delay);
        }

        const sent = await webhook.send({
            content,
            username:        speakerName,
            avatarURL:       speaker.user.displayAvatarURL({ dynamic: true }),
            allowedMentions: { parse: [] },
            ...(channel.isThread?.() && { threadId: channel.id }),
        });
        registerChatterMessage(sent.id, speaker.id);
        turns.push({ name: speakerName, content });
    }

    if (turns.length === 0) {
        return { ok: false, reason: '生成できる発言がありませんでした。' };
    }

    lastMessageTime = Date.now(); // 単発chatterの連投も防ぐ

    const participantNames = participants.map(m => m.displayName || m.user.username);
    console.log(`[Chatter/Exchange] ✅ ${turns.length}件投稿 | 参加者: ${participantNames.join(', ')}`);
    return { ok: true, posted: turns.length, participants: participantNames };
}

async function tryExchangePost(client) {
    const settings  = getSettings();
    const channelId = settings.chatterChannelId ?? settings.lurkerChannelId;
    if (!channelId) return;

    const now = Date.now();
    if (now - lastHumanMessageTime   < EXCHANGE_SILENCE_MS)  return;
    if (now - lastExchangePostedTime < EXCHANGE_COOLDOWN_MS) return;

    const guild = client.guilds.cache.first();
    if (!guild) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const result = await generateExchangeAndPost(client, guild, channel);
    if (result.ok) {
        lastExchangePostedTime = Date.now();
    }
}

// /admin chatter_exchange からの試し打ち用。沈黙・クールダウン判定を無視し、コマンド実行チャンネルに即投稿する
async function forceExchangePost(interaction) {
    return generateExchangeAndPost(interaction.client, interaction.guild, interaction.channel);
}

function initChatter(client) {
    setInterval(() => {
        tryPost(client).catch(e => console.error('[Chatter] エラー:', e.message));
    }, CHECK_INTERVAL_MS);
    setInterval(() => {
        tryExchangePost(client).catch(e => console.error('[Chatter/Exchange] エラー:', e.message));
    }, EXCHANGE_CHECK_INTERVAL_MS);
    console.log('[Chatter] ✅ 初期化 | 1時間無発言で自動投稿 / 3時間無発言で複数人会話');
}

function getLastMessageTime() {
    return lastMessageTime;
}

module.exports = {
    initChatter,
    recordMessage,
    forcePost,
    forceExchangePost,
    getLastMessageTime,
};
