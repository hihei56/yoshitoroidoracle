// chatter.js — 日本時間の時間帯や無料枠残量を踏まえて、複数人格が毎日雑談する自動投稿
const axios = require('axios');
const { pickOneLurker } = require('./lurker_picker');
const { getPersona, setPersona, pickPersonality, pickCriticPersonality } = require('./chatter_persona');
const { getSettings } = require('./config');
const { checkNgWords, normalizeForDetection } = require('./moderator');
const { registerChatterMessage } = require('./chatter_registry');
const { hasBudget, recordUsage, getUsage } = require('./chatter_budget');

const SILENCE_MS        = 60 * 60 * 1000;     // 1時間無発言なら必ず一言挟む
const MIN_GAP_MS        = 10 * 60 * 1000;     // 自発投稿同士の最低間隔（連投防止）
const CHECK_INTERVAL_MS = 5  * 60 * 1000;     // 5分ごとチェック
const CONTEXT_FETCH_LIMIT = 10;               // AI生成に渡す直近メッセージ数

// 深夜帯（日本時間）はみんな寝ている想定で自発発言を控える
const QUIET_HOUR_START = 2; // 2:00〜
const QUIET_HOUR_END   = 6; // 〜6:00 未満

// 沈黙していなくても、活動時間中はこの確率(5分チェックごと)でふと自発的に会話に混ざる
// 無料枠の範囲内でできるだけ「日常会話している感」を出すための調整弁
const SPONTANEOUS_CHANCE = 0.18;

// ラリー（固定人格の投稿にほかのlurkerが連鎖して反応する掛け合い）設定
const RALLY_CHANCE       = 0.6;               // 最初の投稿後にラリーへ発展する確率
const RALLY_MIN_TURNS    = 1;
const RALLY_MAX_TURNS    = 3;
const RALLY_DELAY_MIN_MS = 8_000;
const RALLY_DELAY_MAX_MS = 25_000;

const webhookCache = new Map();
let lastMessageTime = Date.now(); // 起動時は「今」扱い
let lastPostedTime  = 0;

// 現在の日本時間を取得
function getJstParts() {
    const jst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    return { hour: jst.getHours(), minute: jst.getMinutes() };
}

function describeTimeOfDay(hour) {
    if (hour >= 5  && hour < 10) return '朝';
    if (hour >= 10 && hour < 12) return '午前';
    if (hour >= 12 && hour < 15) return '昼過ぎ';
    if (hour >= 15 && hour < 18) return '夕方';
    if (hour >= 18 && hour < 22) return '夜';
    if (hour >= 22 || hour < QUIET_HOUR_START) return '深夜前';
    return '深夜';
}

function isQuietHours(hour) {
    return hour >= QUIET_HOUR_START && hour < QUIET_HOUR_END;
}

// 時間帯ごとに連想させたい話題・空気感（発言そのものにその時間帯らしさを滲ませるためのヒント）
const TIME_TOPIC_HINTS = {
    '朝':     '朝ごはん、眠さ、「おはよう」、これから学校や仕事に行く感じなど',
    '午前':   '午前中にやっていること、ちょっと眠い、コーヒー飲んだ、など',
    '昼過ぎ': 'お昼ごはん食べた／食べる、眠気、休憩中、など',
    '夕方':   '学校や仕事終わり、疲れた、晩ごはん何しようか、など',
    '夜':     '晩ごはん、今日あったこと、まったりしてる、お風呂、など',
    '深夜前': 'そろそろ寝るか迷ってる、夜更かし気味、静かな時間、など',
    '深夜':   '眠い、静かな時間帯にふと目が覚めた、など',
};

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
            // 通常のBotアカウント発言は除外するが、Webhook経由の発言（RSS投稿やなりすまし雑談など）は
            // 会話の流れの一部として踏まえたいので除外しない
            .filter(m => (!m.author.bot || m.webhookId) && m.content?.trim())
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
    const { hour, minute } = getJstParts();
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const timeLabel = describeTimeOfDay(hour);
    const timeHint  = TIME_TOPIC_HINTS[timeLabel] ?? '';
    const timeLine = isReply
        ? `今の日本時間は${timeStr}頃（${timeLabel}）です。直前の発言への反応が中心ですが、話題に困ったら${timeHint}のようなこの時間帯らしい空気感を薄く滲ませても構いません。`
        : `今の日本時間は${timeStr}頃（${timeLabel}）です。${timeHint}など、この時間帯らしさが伝わる内容にしてください。ただし「今${timeStr}だけど」のように時刻をそのまま言うのは不自然なので避け、雰囲気や話題でそれとなく表現してください。`;
    return [
        {
            role: 'system',
            content: `${personaLine} ${situation}${timeLine}直近の会話の流れを踏まえて、くだけた自然な日本語で短い一言（1文、30文字以内目安）を返してください。質問でも独り言でも構いません。${tone}絵文字は基本的に付けず、文章の最後に毎回絵文字を付けるような機械的なパターンは絶対に避けてください（普通の人はそんなに毎回絵文字を使いません）。直近の会話は「名前: 発言」の形式で渡していますが、それはあくまで参考情報であり、あなたの返答にはその形式を真似ず「名前:」のような接頭辞を絶対に付けないでください。発言内容だけを、前置きも名乗りもなしにそのまま返してください。`,
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

// 「名前: 発言」形式の会話ログを渡している影響で、AIが自分の発言にも
// 同じ形式の接頭辞（話者名+コロン）を付けてしまうことがあるため、後処理でも保険をかける
function stripNamePrefix(text) {
    if (!text) return text;
    const stripped = text.replace(/^[^\s:：]{1,20}[:：]\s*/, '').trim();
    return stripped || text.trim();
}

async function generateChatMessage(context, personaName, opts) {
    if (!hasBudget()) {
        console.warn('[Chatter] 本日のAI生成予算（無料枠）を使い切ったため生成をスキップします');
        return null;
    }
    const settings = getSettings();
    const raw = settings.chatterAiProvider === 'cloudflare'
        ? await generateViaCloudflare(context, personaName, settings.chatterAiModel || DEFAULT_CF_MODEL, opts)
        : await generateViaGroq(context, personaName, settings.chatterAiModel || DEFAULT_GROQ_MODEL, opts);
    recordUsage();
    return stripNamePrefix(raw);
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
        if (!hasBudget()) return; // 無料枠を使い切ったらラリーもそこで打ち切る

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
    if (!hasBudget()) return { ok: false, reason: '本日のAI生成予算（無料枠）を使い切ったため休止中です。日本時間の日付が変わると復活します。' };

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

    if (!hasBudget()) return; // 無料枠を使い切った日は静かにする

    const { hour } = getJstParts();
    if (isQuietHours(hour)) return; // 深夜帯はみんな寝ている想定で自発発言しない

    const now = Date.now();
    if (now - lastPostedTime < MIN_GAP_MS) return; // 連投防止の最低間隔

    const silentLongEnough = now - lastMessageTime >= SILENCE_MS;
    const spontaneous = Math.random() < SPONTANEOUS_CHANCE;
    // 沈黙が長ければ必ず一言挟み、そうでなくても活動時間中は一定確率でふと会話に混ざる
    if (!silentLongEnough && !spontaneous) return;

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
    const { budget } = getUsage();
    console.log(`[Chatter] ✅ 初期化 | 深夜${QUIET_HOUR_START}〜${QUIET_HOUR_END}時は休止 / 1日の無料枠予算=${budget}回`);
}

function getLastMessageTime() {
    return lastMessageTime;
}

module.exports = { initChatter, recordMessage, forcePost, getLastMessageTime };
