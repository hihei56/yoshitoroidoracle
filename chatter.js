// chatter.js — 日本時間の時間帯や無料枠残量を踏まえて、複数人格が毎日雑談する自動投稿
const axios = require('axios');
const { pickOneLurker } = require('./lurker_picker');
const { getPersona, setPersona, pickPersonality, pickCriticPersonality, MOUNT_PERSONALITY, GROOM_PERSONALITY, SPAM_PERSONALITY, ANIMAL_PERSONALITY } = require('./chatter_persona');
const { getSettings } = require('./config');
const { checkNgWords, normalizeForDetection } = require('./moderator');
const { registerChatterMessage } = require('./chatter_registry');
const { hasBudget, recordUsage, getUsage } = require('./chatter_budget');
const { fetchRandomQuote } = require('./stock_quote');
const { fetchRandomAnimalImage } = require('./animal_image');

const SILENCE_MS        = 20 * 60 * 1000;     // 20分無発言なら必ず一言挟む
const MIN_GAP_MS        = 4  * 60 * 1000;     // 自発投稿同士の最低間隔（連投防止）
const CHECK_INTERVAL_MS = 2  * 60 * 1000;     // 2分ごとチェック
const CONTEXT_FETCH_LIMIT = 10;               // AI生成に渡す直近メッセージ数

// 「深夜」ラベルの境界時刻（時間帯の言い回しにのみ使用。投稿の休止はしない）
const QUIET_HOUR_START = 2;

// 沈黙していなくても、活動時間中はこの確率(2分チェックごと)でふと自発的に会話に混ざる
// Groq/Cloudflare/Geminiの複数プロバイダー自動ローテーションで無料枠の合計が増えたため、
// 頻度を上げても余裕を持って回せる
const SPONTANEOUS_CHANCE = 0.35;

// ラリー（固定人格の投稿にほかのlurkerが連鎖して反応する掛け合い）設定
const RALLY_CHANCE       = 0.85;              // 最初の投稿後にラリーへ発展する確率
const RALLY_MIN_TURNS    = 2;
const RALLY_MAX_TURNS    = 5;
const RALLY_DELAY_MIN_MS = 8_000;
const RALLY_DELAY_MAX_MS = 25_000;

// ラリーに味変で交ざる固定キャラたち（毎回は出さず、たまに登場する程度の確率）
const MOUNT_APPEAR_CHANCE  = 0.4; // 教養マウント役
const GROOM_APPEAR_CHANCE  = 0.4; // グルーミング仕草役
const SPAM_APPEAR_CHANCE   = 0.4; // スパム役
const ANIMAL_APPEAR_CHANCE = 0.4; // 動物画像役

// 動物画像役の設定（画像単体、またはキャプション付きで貼る）
const ANIMAL_CAPTION_CHANCE = 0.5;
const ANIMAL_CAPTIONS = ['見て！', 'かわいすぎる', 'これは癒される', 'めっちゃかわいくない？', '和むわ〜'];

// スパム役の定型文設定
const SPAM_GENERIC_PHRASES  = ['う', 'あ〜超うれしい！'];
const SPAM_SIGNATURE_PHRASE = 'イーッヒッヒッヒッwww😂';
const SPAM_SIGNATURE_CHANCE = 0.4;  // 定型文を出すとき、内輪ノリの決まり文句を選ぶ確率
const SPAM_STOCK_CHANCE     = 0.05; // 極稀に人が変わったように真剣な投資トークをする確率

// スパム役が決まり文句を言うと、内輪ノリとして他のlurkerも連鎖して同じ台詞を繰り返すことがある
const SIGNATURE_CHAIN_CHANCE      = 0.5;
const SIGNATURE_CHAIN_MIN_TURNS   = 1;
const SIGNATURE_CHAIN_MAX_TURNS   = 3;
const SIGNATURE_CHAIN_DELAY_MIN_MS = 3_000;
const SIGNATURE_CHAIN_DELAY_MAX_MS = 12_000;

// このユーザーになりすまして「main」人格として固定登場させ、会話の中心にする。
// 他のAI（lurkerなりすまし）がこの人格の直前の発言に反応するターンだけ疑似リプライを使う
const TARGET_USER_ID      = '673059482842038274';
const TARGET_QUOTE_MAX_LEN = 60; // 疑似リプライの引用は短く切り詰める

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

const DEFAULT_CF_MODEL     = '@cf/meta/llama-3.1-8b-instruct-fast';
const DEFAULT_GROQ_MODEL   = 'qwen/qwen3-32b';
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

function buildChatterMessages(context, personaName, { personality, isReply = false, contrarian = false, replyTarget = null, stockMode = false, stockQuote = null } = {}) {
    const personaLine = personality
        ? `あなたは「${personaName}」というDiscordサーバーの一般メンバーです。性格: ${personality} この性格が口調や話の入り方ににじみ出るようにしてください。`
        : `あなたは「${personaName}」というDiscordサーバーの一般メンバーです。`;
    const situation = stockMode
        ? (stockQuote
            ? `いつもは定型文の連呼で場を荒らしているキャラですが、今だけは人が変わったように急に真剣なトーンになり、株や投資について一言だけ話すところです。普段とのギャップが伝わるようにしてください。ちなみに直近の${stockQuote.name}の終値は${stockQuote.close}円（${stockQuote.date}時点）でした。信用取引・投機的な短期売買を好む口調で、この値動きに軽く触れても構いません。`
            : 'いつもは定型文の連呼で場を荒らしているキャラですが、今だけは人が変わったように急に真剣なトーンになり、株や投資について一言だけ話すところです。普段とのギャップが伝わるようにしてください。ただし実際の株価やニュースは分からないので、具体的な銘柄名や数値を断定的に言うのは避け、信用取引・投機的な短期売買を好む心構えについての一言にとどめてください。')
        : replyTarget
        ? `友達同士の雑談チャンネルで、「${replyTarget.name}」が「${replyTarget.content}」と発言したので、それを踏まえて自然に返信するところです。`
        : isReply
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
        ? `参考: 今は${timeLabel}の時間帯です。直前の発言への反応が中心ですが、話題に困ったら${timeHint}を話題の種にしても構いません。`
        : `参考: 今は${timeLabel}の時間帯なので、${timeHint}あたりを話題の種にしてもいいですが、あくまで一例です。他の話題でも構いません。`;
    const varietyLine = '「この時間、誰か〜してない？」「〜な気分」のような、毎回同じ構文・同じ書き出しのテンプレートは絶対に使わないでください。独り言・ぼやき・感想・驚き・愚痴・質問など、文の型は投稿のたびに大きく変えてください。「時間帯」「この時間」という単語そのものを文章に含めないでください。';
    const punctuationLine = '実際のDiscordユーザーの書き込みのように、句点「。」は付けず、読点「、」も律儀に毎回入れず、必要な時だけ最小限にしてください（読点をリズムよく毎回打つのは不自然で機械的に見えます）。';
    return [
        {
            role: 'system',
            content: `${personaLine} ${situation}${timeLine}${varietyLine}${punctuationLine}直近の会話の流れを踏まえて、くだけた自然な日本語で短い一言（1文、30文字以内目安）を返してください。${tone}絵文字は基本的に付けず、文章の最後に毎回絵文字を付けるような機械的なパターンは絶対に避けてください（普通の人はそんなに毎回絵文字を使いません）。直近の会話は「名前: 発言」の形式で渡していますが、それはあくまで参考情報であり、あなたの返答にはその形式を真似ず「名前:」のような接頭辞を絶対に付けないでください。発言内容だけを、前置きも名乗りもなしにそのまま返してください。`,
        },
        {
            role: 'user',
            content: context ? `直近の会話:\n${context}` : '（しばらく誰も発言していません）',
        },
    ];
}

// プロバイダーがレート制限(429)を返した場合、この期間は候補から外してフォールバックさせる
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
const rateLimitedUntil = {}; // provider -> 復帰予定time(ms)

function markRateLimited(provider) {
    rateLimitedUntil[provider] = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    console.warn(`[Chatter] ⚠️ ${provider}がレート制限中の可能性 → ${RATE_LIMIT_COOLDOWN_MS / 60000}分間フォールバック対象から外します`);
}

function isRateLimited(provider) {
    return (rateLimitedUntil[provider] ?? 0) > Date.now();
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
        if (e.response?.status === 429) markRateLimited('groq');
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
        if (e.response?.status === 429) markRateLimited('cloudflare');
        console.error(`[Chatter] Cloudflare AI生成エラー(model=${model}):`, e.message);
        return null;
    }
}

async function generateViaGemini(context, personaName, model, opts) {
    if (!process.env.GEMINI_API_KEY) return null;
    try {
        const messages    = buildChatterMessages(context, personaName, opts);
        const systemText  = messages.find(m => m.role === 'system')?.content ?? '';
        const userText    = messages.find(m => m.role === 'user')?.content ?? '';

        const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
                systemInstruction: { parts: [{ text: systemText }] },
                contents: [{ role: 'user', parts: [{ text: userText }] }],
                generationConfig: { temperature: 0.9, maxOutputTokens: 60 },
            },
            {
                params: { key: process.env.GEMINI_API_KEY },
                timeout: 15_000,
            }
        );
        return res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    } catch (e) {
        if (e.response?.status === 429) markRateLimited('gemini');
        console.error(`[Chatter] Gemini生成エラー(model=${model}):`, e.message);
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

// 実際のDiscordユーザーは文末に句点を付けないため、プロンプトの指示をすり抜けた分を保険で除去する
function stripTrailingPeriod(text) {
    if (!text) return text;
    return text.replace(/。+$/, '').trim() || text.trim();
}

const PROVIDER_DEFAULT_MODELS = {
    groq: DEFAULT_GROQ_MODEL,
    cloudflare: DEFAULT_CF_MODEL,
    gemini: DEFAULT_GEMINI_MODEL,
};

// フォールバックの優先順位（普段はgroqを使い、ダメなら順に切り替える）
const PROVIDER_PRIORITY = ['groq', 'cloudflare', 'gemini'];

function isProviderConfigured(provider) {
    if (provider === 'groq')       return !!process.env.GROQ_API_KEY;
    if (provider === 'cloudflare') return !!(process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN);
    if (provider === 'gemini')     return !!process.env.GEMINI_API_KEY;
    return false;
}

// APIキーが設定済み、本日の無料枠が残っていて、直近レート制限に引っかかっていないプロバイダーか
function isProviderReady(provider) {
    return isProviderConfigured(provider) && hasBudget(provider) && !isRateLimited(provider);
}

// いずれかのプロバイダー（設定で固定している場合はそれのみ）で今すぐ生成できるか
function anyBudgetAvailable() {
    const settings = getSettings();
    const forced   = settings.chatterAiProvider;
    if (forced && forced !== 'auto') return isProviderReady(forced);
    return PROVIDER_PRIORITY.some(isProviderReady);
}

async function callProvider(provider, context, personaName, model, opts) {
    if (provider === 'cloudflare') return generateViaCloudflare(context, personaName, model, opts);
    if (provider === 'gemini')     return generateViaGemini(context, personaName, model, opts);
    return generateViaGroq(context, personaName, model, opts);
}

// 'auto'設定時は、普段はGroqを優先して使い、無料枠切れ・レート制限などで使えない時だけ
// Cloudflare→Geminiの順にフォールバックする。特定プロバイダーを指定している場合はそれ固定
async function generateChatMessage(context, personaName, opts) {
    const settings = getSettings();
    const forced   = settings.chatterAiProvider;
    const isAuto   = !forced || forced === 'auto';

    const candidates = isAuto
        ? PROVIDER_PRIORITY.filter(isProviderReady)
        : (isProviderReady(forced) ? [forced] : []);

    for (const provider of candidates) {
        const model = (!isAuto && settings.chatterAiModel) || PROVIDER_DEFAULT_MODELS[provider];
        const raw = await callProvider(provider, context, personaName, model, opts);
        recordUsage(provider);
        if (raw) return stripTrailingPeriod(stripNamePrefix(raw));
        // 失敗（レート制限・生成エラー等）した場合は次の候補にフォールバック
    }

    console.warn('[Chatter] 利用可能なAIプロバイダーがない（無料枠切れ・レート制限・未設定）ため生成をスキップします');
    return null;
}

async function ensurePersona(guild) {
    let persona = await getPersona(guild, 'main');
    if (persona) return persona;

    // 会話の中心にするTARGET_USER_IDが取得できれば最優先でメイン人格にする
    const forced = await guild.members.fetch(TARGET_USER_ID).catch(() => null);
    const member = forced ?? (await pickOneLurker(guild, {})).member;
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

// 教養マウント役。誰も興味のない哲学トークをドヤ顔で披露する固定キャラ
async function ensureMountPersona(guild, excludeId) {
    let persona = await getPersona(guild, 'mount');
    if (persona) return persona;

    const { member } = await pickOneLurker(guild, { lastPickedId: excludeId });
    if (!member) return null;
    setPersona(member.id, MOUNT_PERSONALITY, 'mount');
    return { lurkerId: member.id, personality: MOUNT_PERSONALITY, member };
}

// グルーミング仕草役。「よしよし」「すきだよ」で構ってくる固定キャラ
async function ensureGroomPersona(guild, excludeId) {
    let persona = await getPersona(guild, 'groom');
    if (persona) return persona;

    const { member } = await pickOneLurker(guild, { lastPickedId: excludeId });
    if (!member) return null;
    setPersona(member.id, GROOM_PERSONALITY, 'groom');
    return { lurkerId: member.id, personality: GROOM_PERSONALITY, member };
}

// スパム役。定型文を連呼して荒らすが、極稀に真剣な投資トークをする固定キャラ
async function ensureSpamPersona(guild, excludeId) {
    let persona = await getPersona(guild, 'spam');
    if (persona) return persona;

    const { member } = await pickOneLurker(guild, { lastPickedId: excludeId });
    if (!member) return null;
    setPersona(member.id, SPAM_PERSONALITY, 'spam');
    return { lurkerId: member.id, personality: SPAM_PERSONALITY, member };
}

// 動物画像役。Cat API/Dog APIなどから拾ってきた動物画像をふと貼ってくる固定キャラ
async function ensureAnimalPersona(guild, excludeId) {
    let persona = await getPersona(guild, 'animal');
    if (persona) return persona;

    const { member } = await pickOneLurker(guild, { lastPickedId: excludeId });
    if (!member) return null;
    setPersona(member.id, ANIMAL_PERSONALITY, 'animal');
    return { lurkerId: member.id, personality: ANIMAL_PERSONALITY, member };
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

// Webhook経由の投稿はDiscordの本物のリプライ（message_reference）を張れないため、
// 引用ブロックで見た目だけ「返信」を再現する疑似リプライ
function buildPseudoReply(targetName, targetContent, replyBody) {
    const sanitized = (targetContent || '').replace(/\s+/g, ' ').trim() || '(画像/添付ファイル)';
    const snippet = sanitized.length > TARGET_QUOTE_MAX_LEN
        ? sanitized.slice(0, TARGET_QUOTE_MAX_LEN) + '…'
        : sanitized;
    return `> **${targetName}**: ${snippet}\n${replyBody}`;
}

// スパム役が決まり文句「イーッヒッヒッヒッwww😂」を言うと、内輪ノリとして他のlurkerも
// 連鎖して同じ台詞を繰り返すことがある。AI生成を挟まないので無料枠は消費しない
async function runSignatureChain(client, guild, channel, excludeId) {
    if (Math.random() >= SIGNATURE_CHAIN_CHANCE) return;
    const turns = SIGNATURE_CHAIN_MIN_TURNS + Math.floor(Math.random() * (SIGNATURE_CHAIN_MAX_TURNS - SIGNATURE_CHAIN_MIN_TURNS + 1));
    let lastSpeakerId = excludeId;

    for (let i = 0; i < turns; i++) {
        await wait(SIGNATURE_CHAIN_DELAY_MIN_MS + Math.random() * (SIGNATURE_CHAIN_DELAY_MAX_MS - SIGNATURE_CHAIN_DELAY_MIN_MS));

        const { member } = await pickOneLurker(guild, { lastPickedId: lastSpeakerId });
        if (!member) return;
        const name = member.displayName || member.user.username;

        const sent = await sendChatterLine(client, channel, name, member.user.displayAvatarURL({ dynamic: true }), SPAM_SIGNATURE_PHRASE);
        registerChatterMessage(sent.id, member.id);
        console.log(`[Chatter] 🔁 内輪ノリ連鎖 "${SPAM_SIGNATURE_PHRASE}" | なりすまし: ${name}`);

        lastSpeakerId = member.id;
        lastMessageTime = Date.now();
    }
}

// 固定人格の投稿をきっかけに、ほかのlurkerがランダムな回数だけ連鎖して反応する「ラリー」
// 全肯定だけで終わらないよう、必ず1回は批評家役が交ざって水を差す。教養マウント役・グルーミング役・
// スパム役は味変としてたまに交ざる程度（ターン数が足りなければ登場しないこともある）
async function runRally(client, guild, channel, baseContext, history, excludeId) {
    const turns = RALLY_MIN_TURNS + Math.floor(Math.random() * (RALLY_MAX_TURNS - RALLY_MIN_TURNS + 1));

    const critic = await ensureCriticPersona(guild, excludeId);
    const mount  = Math.random() < MOUNT_APPEAR_CHANCE  ? await ensureMountPersona(guild, excludeId)  : null;
    const groom  = Math.random() < GROOM_APPEAR_CHANCE  ? await ensureGroomPersona(guild, excludeId)  : null;
    const spam   = Math.random() < SPAM_APPEAR_CHANCE   ? await ensureSpamPersona(guild, excludeId)   : null;
    const animal = Math.random() < ANIMAL_APPEAR_CHANCE ? await ensureAnimalPersona(guild, excludeId) : null;

    // ターンが重複しないよう、登場が決まったキャラから順にターン番号を抽選で割り当てる
    const availableTurns = Array.from({ length: turns }, (_, i) => i);
    function assignTurn() {
        if (!availableTurns.length) return -1;
        const idx = Math.floor(Math.random() * availableTurns.length);
        return availableTurns.splice(idx, 1)[0];
    }
    const criticTurn = critic ? assignTurn() : -1;
    const mountTurn  = mount  ? assignTurn() : -1;
    const groomTurn  = groom  ? assignTurn() : -1;
    const spamTurn   = spam   ? assignTurn() : -1;
    const animalTurn = animal ? assignTurn() : -1;

    let lastSpeakerId = excludeId;

    for (let i = 0; i < turns; i++) {
        await wait(randomRallyDelay());
        if (!anyBudgetAvailable()) return; // 無料枠を使い切ったらラリーもそこで打ち切る

        let special = null;
        let roleLabel = '';
        if (i === criticTurn && critic.member.id !== lastSpeakerId) {
            special = { member: critic.member, role: 'critic', opts: { isReply: true, personality: critic.personality, contrarian: true } };
            roleLabel = '（批評家役）';
        } else if (i === mountTurn && mount.member.id !== lastSpeakerId) {
            special = { member: mount.member, role: 'mount', opts: { isReply: true, personality: mount.personality } };
            roleLabel = '（教養マウント役）';
        } else if (i === groomTurn && groom.member.id !== lastSpeakerId) {
            special = { member: groom.member, role: 'groom', opts: { isReply: true, personality: groom.personality } };
            roleLabel = '（グルーミング役）';
        } else if (i === spamTurn && spam.member.id !== lastSpeakerId) {
            special = { member: spam.member, role: 'spam', opts: { isReply: true, personality: spam.personality } };
            roleLabel = '（スパム役）';
        } else if (i === animalTurn && animal.member.id !== lastSpeakerId) {
            special = { member: animal.member, role: 'animal', opts: {} };
            roleLabel = '（動物画像役）';
        }

        const picked = special ? special.member : (await pickOneLurker(guild, { lastPickedId: lastSpeakerId })).member;
        if (!picked) return;

        const rallyContext = `${baseContext ? baseContext + '\n' : ''}${history.map(h => `${h.name}: ${h.content}`).join('\n')}`;
        const name = picked.displayName || picked.user.username;

        // 直前の発言者が「会話の中心（TARGET_USER_IDのなりすまし）」だったターンだけ疑似リプライにする
        const replyingToTarget = lastSpeakerId === TARGET_USER_ID;
        const lastEntry = history[history.length - 1];

        let content;
        let historyText; // AIへの文脈用には引用ブロックを含めない生の発言を残す
        if (special?.role === 'spam' && Math.random() < SPAM_STOCK_CHANCE) {
            // 極稀に真剣な投資トークへ。取得できればJDI/キオクシアの直近終値を添える
            const quote = await fetchRandomQuote().catch(() => null);
            content = await generateChatMessage(rallyContext, name, { ...special.opts, stockMode: true, stockQuote: quote });
            historyText = content;
        } else if (special?.role === 'spam') {
            // 通常は定型文をそのまま投げる（AI生成を挟まないので無料枠も消費しない）
            content = Math.random() < SPAM_SIGNATURE_CHANCE
                ? SPAM_SIGNATURE_PHRASE
                : SPAM_GENERIC_PHRASES[Math.floor(Math.random() * SPAM_GENERIC_PHRASES.length)];
            historyText = content;
        } else if (special?.role === 'animal') {
            // Cat API/Dog APIなどから画像URLを取得して貼るだけ（AI生成を挟まないので無料枠も消費しない）
            const image = await fetchRandomAnimalImage().catch(() => null);
            if (!image) return; // 取得できなければラリーを打ち切る
            content = Math.random() < ANIMAL_CAPTION_CHANCE
                ? `${ANIMAL_CAPTIONS[Math.floor(Math.random() * ANIMAL_CAPTIONS.length)]}\n${image.url}`
                : image.url;
            historyText = content;
        } else {
            // 直前の発言者が誰であっても、その発言宛てだと分かる形で返信させる
            // （見た目の疑似リプライ引用は会話の中心＝TARGET_USER_IDへの返信の時だけ）
            const baseOpts = special ? special.opts : { isReply: true };
            const opts = lastEntry ? { ...baseOpts, replyTarget: { name: lastEntry.name, content: lastEntry.content } } : baseOpts;
            const replyBody = await generateChatMessage(rallyContext, name, opts);
            content = (replyBody && replyingToTarget && lastEntry)
                ? buildPseudoReply(lastEntry.name, lastEntry.content, replyBody)
                : replyBody;
            historyText = replyBody;
        }
        if (!content) return; // 生成できなければラリーを打ち切る

        const { hit } = checkNgWords(normalizeForDetection(content));
        if (hit) return;

        const sent = await sendChatterLine(client, channel, name, picked.user.displayAvatarURL({ dynamic: true }), content);
        registerChatterMessage(sent.id, picked.id);
        console.log(`[Chatter] 🔁 ラリー "${content}" | なりすまし: ${name}${roleLabel}${replyingToTarget && content !== historyText ? '（疑似リプライ）' : ''}`);

        if (content === SPAM_SIGNATURE_PHRASE) {
            runSignatureChain(client, guild, channel, picked.id)
                .catch(e => console.error('[Chatter] 内輪ノリ連鎖エラー:', e.message));
        }

        history.push({ name, content: historyText });
        lastSpeakerId = picked.id;
        lastMessageTime = Date.now(); // ラリー継続中も無発言タイマーをリセット
    }
}

async function generateAndPost(client, guild, channel) {
    if (!anyBudgetAvailable()) return { ok: false, reason: '本日のAI生成予算（無料枠）を使い切ったため休止中です。日本時間の日付が変わると復活します。' };

    const persona = await ensurePersona(guild);
    if (!persona) return { ok: false, reason: 'なりすまし対象のlurkerが見つかりませんでした。' };
    const personaName = persona.member.displayName || persona.member.user.username;

    const context = await fetchRecentContext(channel);
    let content = await generateChatMessage(context, personaName, { personality: persona.personality });
    let source  = content ? 'AI' : null;

    if (content) {
        const { hit } = checkNgWords(normalizeForDetection(content));
        if (hit) {
            console.warn(`[Chatter] AI生成文がNGワードに抵触したため破棄: "${content}"`);
            content = null;
            source = null;
        }
    }
    if (!content) {
        // APIキーが1つも設定されていない（=AIでの生成手段が本当にない）時だけ絵文字で代替する。
        // プロバイダーが設定済みなのに失敗した場合は、絵文字スパムにせずこのサイクルは投稿を見送る
        const noProviderAtAll = PROVIDER_PRIORITY.every(p => !isProviderConfigured(p));
        if (noProviderAtAll) {
            content = buildEmojiContent(guild);
            source  = content ? '絵文字' : null;
        } else {
            console.warn('[Chatter] AI生成に失敗したため今回は投稿を見送ります（原因は直前のエラーログを参照）');
            return { ok: false, reason: 'AI生成に失敗したため投稿を見送りました。' };
        }
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

    if (!anyBudgetAvailable()) return; // 無料枠を使い切った日は静かにする

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

    const configured = PROVIDER_PRIORITY.filter(isProviderConfigured);
    const budgetSummary = configured.length
        ? configured.map(p => `${p}=${getUsage(p).budget}回`).join(' / ')
        : 'なし（APIキー未設定）';
    console.log(`[Chatter] ✅ 初期化 | 24時間休止なし / フォールバック順=${PROVIDER_PRIORITY.join('→')} / 有効プロバイダーの1日予算: ${budgetSummary}`);
}

function getLastMessageTime() {
    return lastMessageTime;
}

// /admin表示用: プロバイダーごとのAPIキー設定有無と本日の無料枠利用状況
function getProviderStatus() {
    return PROVIDER_PRIORITY.map(provider => ({
        provider,
        configured: isProviderConfigured(provider),
        ...getUsage(provider),
    }));
}

module.exports = { initChatter, recordMessage, forcePost, getLastMessageTime, getProviderStatus };
