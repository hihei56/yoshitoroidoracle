// moderator.js — 最終版
// NGワード検知 + sexual/minors APIチェック（画像・NGヒット時のみ）

const axios  = require('axios');
const { OpenAI } = require('openai');
const { getModExcludeList } = require('./exclude_manager');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* =========================
   🔐 ロール設定
========================= */
const EXEMPT_ROLES = [
    '1486178659130933278',
    '1477024387524857988',
    '1478715790575538359',
];
const SENSITIVE_ALLOWED_ROLES = [
    '1486178659130933278',
    '1477024387524857988',
];
const ALLOWED_ROLES           = ['1476944370694488134', '1478715790575538359'];
const SENSITIVE_TRIGGER_EMOJI = '👶';
const TUPPERBOX_APP_ID        = '431544605209788416';
const TUPPERBOX_PREFIX_REGEX  = /^([a-zA-Z]+!)(.*)$/;

/* =========================
   🔐 ゼロ幅文字でUserIDを隠す
========================= */
const ZERO_WIDTH_MAP     = { '0': '\u200B', '1': '\u200C' };
const REVERSE_ZERO_WIDTH = { '\u200B': '0', '\u200C': '1' };

function hideUserId(userId) {
    return [...BigInt(userId).toString(2)].map(b => ZERO_WIDTH_MAP[b]).join('');
}

function extractUserId(text) {
    if (!text) return null;
    const bits = [...text].filter(c => REVERSE_ZERO_WIDTH[c]).map(c => REVERSE_ZERO_WIDTH[c]).join('');
    if (!bits) return null;
    try { return BigInt('0b' + bits).toString(); } catch { return null; }
}

/* =========================
   🛡️ 権限チェック
========================= */
function hasModPermission(member) {
    if (!member) return false;
    if (member.permissions.has('Administrator')) return true;
    return ALLOWED_ROLES.some(id => member.roles.cache.has(id));
}

/* =========================
   🚦 スパムトラッカー
   - 10秒で5件
   - 3秒で3件（バースト検知）
========================= */
const spamTracker = new Map();

function checkSpam(userId) {
    const now   = Date.now();
    const times = (spamTracker.get(userId) || []).filter(t => now - t < 10_000);
    if (times.length >= 5 || (times.length >= 3 && now - times[0] < 3_000)) return true;
    times.push(now);
    spamTracker.set(userId, times);
    return false;
}

setInterval(() => {
    const now = Date.now();
    for (const [id, times] of spamTracker) {
        if (times.every(t => now - t >= 10_000)) spamTracker.delete(id);
    }
}, 60_000);

/* =========================
   🛡️ NGワード検知
========================= */
const LOLI_SHOTA_REGEX = new RegExp([
    'ロリ','ろり','ﾛﾘ','loli',
    'ショタ','しょた','ｼｮﾀ','shota',
    'ロリコン','ろりこん','lolicon',
    'ショタコン','しょたこん','shotacon',
    'ろ\\W*り','しょ\\W*た',
    'l\\W*o\\W*l\\W*i','s\\W*h\\W*o\\W*t\\W*a',
    '幼女','幼男','児童','未成年','キッズ',
    '小学生','中学生','小学校','中学校',
    'エプスタイン','🧒','👧','👦','🍼','🎒',
].join('|'), 'i');

const AGE_REGEX = new RegExp([
    '(?<![0-9０-９])(?:[0-9]|1[0-2])(?:歳|才|さい)',
    '(?<![0-9０-９])(?:[０-９]|１[０-２])(?:歳|才|さい)',
    '(?:一|二|三|四|五|六|七|八|九|十|十一|十二)(?:歳|才|さい)',
    '13歳未満','小[1-6]','中[1-3]',
].join('|'), 'i');

const THREAT_REGEX = new RegExp([
    '殺','死ね','しね','殺す','ころす','殺してやる',
    '爆破','爆殺','刺す','刺してやる',
    'kill\\s*you',"i'll\\s*kill",'gonna\\s*kill',
    '自殺しろ','死んでください',
].join('|'), 'i');

const DRUG_REGEX = new RegExp([
    '覚醒剤','覚せい剤','MDM[Aa]','コカイン','ヘロイン',
    '大麻','マリファナ','危険ドラッグ','脱法ドラッグ',
    'シャブ','やく(?:を|買|売|やる)',
    'drug\\s*deal','sell\\s*drug',
].join('|'), 'i');

function checkNgWords(text) {
    const matched = [];
    if (LOLI_SHOTA_REGEX.test(text)) matched.push('loli_shota');
    if (AGE_REGEX.test(text))        matched.push('age');
    if (THREAT_REGEX.test(text))     matched.push('threat');
    if (DRUG_REGEX.test(text))       matched.push('drug');
    return { hit: matched.length > 0, matched };
}

/* =========================
   📎 添付ファイル取得
   削除前にバイナリ確保。Oracle環境で弾かれたら空配列にフォールバック
========================= */
const DL_CONFIG = { MAX_FILES: 4, MAX_SIZE: 8 * 1024 * 1024, TIMEOUT: 4_000 };

async function downloadFiles(attachments) {
    const files = [];
    for (const att of [...attachments.values()].slice(0, DL_CONFIG.MAX_FILES)) {
        if (att.size > DL_CONFIG.MAX_SIZE) continue;
        try {
            const res = await axios.get(att.url, {
                responseType: 'arraybuffer',
                timeout: DL_CONFIG.TIMEOUT,
            });
            files.push({ attachment: Buffer.from(res.data), name: att.name || 'file' });
        } catch {
            // 弾かれても続行（他の添付は試みる）
        }
    }
    return files;
}


/* =========================
   🤖 AIテキストモデレーション
   テキストのみ・全カテゴリ対象・画像なし
   返り値: { flagged: bool, reason: string|null }
========================= */

// 削除するカテゴリと閾値
const AI_THRESHOLDS = {
    'sexual/minors':          0.3,   // 児童性的：低めに設定（見逃しNG）
    harassment:               0.92,
    'harassment/threatening': 0.92,
    hate:                     0.92,
    'hate/threatening':       0.92,
    sexual:                   0.92,
    'self-harm':              0.92,
    violence:                 0.92,
    'violence/graphic':       0.92,
};

async function checkAiModeration(text) {
    if (!text?.trim() || !process.env.OPENAI_API_KEY) return { flagged: false, reason: null };

    try {
        const result = await openai.moderations.create({
            model: 'omni-moderation-latest',
            input: text,
        });
        const scores = result.results[0]?.category_scores ?? {};

        for (const [cat, threshold] of Object.entries(AI_THRESHOLDS)) {
            if ((scores[cat] ?? 0) > threshold) {
                return { flagged: true, reason: cat };
            }
        }
        return { flagged: false, reason: null };
    } catch (e) {
        console.error('[AI Mod] API失敗:', e.message);
        return { flagged: false, reason: null };
    }
}

/* =========================
   📝 削除ログ
========================= */
function logDeletion({ message, matched }) {
    const ts      = new Date().toISOString();
    const tag     = message.author.tag;
    const userId  = message.author.id;
    const channel = message.channel.name ?? message.channelId;
    const preview = (message.content ?? '').slice(0, 80).replace(/\n/g, ' ');
    console.warn(`[MOD] ${ts} | #${channel} | ${tag}(${userId}) | matched=${JSON.stringify(matched)} | "${preview}"`);
}

/* =========================
   ✨ テキスト整形
========================= */
function stripTupperPrefix(content) {
    if (!content) return content;
    const m = content.match(TUPPERBOX_PREFIX_REGEX);
    return m ? m[2].trim() : content;
}

function recodeText(text) {
    if (!text) return '';
    let c = text;
    c = c.replace(/^@(?:\[[^\]]+\]\s*)?[^\s]+\s*/, '');
    [/ら?警察いた/g, /警察/g, /🚓/g].forEach(p => (c = c.replace(p, '')));
    return c.trim();
}

/* =========================
   📍 Webhook管理（Race Condition対策付き）
========================= */
const webhookCache    = new Map();
const webhookPromises = new Map();
const WEBHOOK_CACHE_TTL = 24 * 60 * 60 * 1000;

async function getOrCreateWebhook(channel) {
    const target = channel.isThread() ? channel.parent : channel;
    if (!target) return null;
    const key = target.id;

    const cached = webhookCache.get(key);
    if (cached && Date.now() - cached.timestamp < WEBHOOK_CACHE_TTL) return cached.webhook;

    // 同一チャンネルへの同時リクエストを1つにまとめる
    if (webhookPromises.has(key)) return webhookPromises.get(key);

    const promise = (async () => {
        try {
            const hooks = await target.fetchWebhooks();
            let wh = hooks.find(h => h.token);
            if (!wh) wh = await target.createWebhook({ name: 'Moderator' });
            webhookCache.set(key, { webhook: wh, timestamp: Date.now() });
            return wh;
        } catch (e) {
            console.error(`[Webhook] 取得失敗: ${e.message}`);
            return null;
        } finally {
            webhookPromises.delete(key);
        }
    })();

    webhookPromises.set(key, promise);
    return promise;
}

async function sendWebhook(channel, options) {
    const target = channel.isThread() ? channel.parent : channel;
    const key    = target?.id;
    const wh     = await getOrCreateWebhook(channel);
    if (!wh) return null;

    try {
        return await wh.send(options);
    } catch (e) {
        if (key) webhookCache.delete(key);
        console.error(`[Webhook] 送信失敗、リトライ: ${e.message}`);
        try {
            const retry = await getOrCreateWebhook(channel);
            return retry ? await retry.send(options) : null;
        } catch (e2) {
            console.error(`[Webhook] リトライ失敗: ${e2.message}`);
            return null;
        }
    }
}

/* =========================
   💬 リプライ装飾
========================= */
async function buildReplyPrefix(message) {
    if (!message.reference?.messageId) return '';
    try {
        const ref = await message.channel.messages.fetch(message.reference.messageId);
        let targetId = ref.author.id;
        if (ref.webhookId) {
            const extracted = extractUserId(ref.content);
            if (extracted) targetId = extracted;
        }
        let parentRaw = [...(ref.content || '')].filter(c => !REVERSE_ZERO_WIDTH[c]).join('').trim();
        const preview = parentRaw.length > 80
            ? parentRaw.substring(0, 77).replace(/\n/g, ' ') + '...'
            : parentRaw.replace(/\n/g, ' ');
        const jumpUrl = `https://discord.com/channels/${message.guildId}/${message.channelId}/${ref.id}`;
        return `> [Reply to:](${jumpUrl}) <@${targetId}>\n> ${preview}\n`;
    } catch { return ''; }
}

/* =========================
   💬 疑似リプライ処理
========================= */
async function handlePseudoReply(message) {
    if (!hasModPermission(message.member)) return false;
    if (!message.reference?.messageId)     return false;

    let ref;
    try { ref = await message.channel.messages.fetch(message.reference.messageId); }
    catch { return false; }

    if (!ref.webhookId || ref.applicationId === TUPPERBOX_APP_ID) return false;
    if (!extractUserId(ref.content)) return false;

    if (message.deletable) await message.delete().catch(() => {});

    const replyPrefix  = await buildReplyPrefix(message);
    const replyContent = `${replyPrefix}${recodeText(message.content)}${hideUserId(message.author.id)}`;

    const opts = {
        content:         replyContent,
        files:           [],
        username:        message.member?.displayName || message.author.username,
        avatarURL:       message.member?.displayAvatarURL({ dynamic: true }),
        allowedMentions: { parse: ['users'] },
    };
    if (message.channel.isThread()) opts.threadId = message.channel.id;

    await sendWebhook(message.channel, opts);
    return true;
}

/* =========================
   🔞 センシティブ投稿処理
========================= */
async function handleSensitivePost(message) {
    const hasPerm = SENSITIVE_ALLOWED_ROLES.some(id => message.member?.roles.cache.has(id));
    if (!hasPerm) return false;

    const hasTrigger = message.content?.includes(SENSITIVE_TRIGGER_EMOJI);
    const hasAttach  = message.attachments.size > 0;
    if (!hasTrigger || !hasAttach) return false;

    // センシティブはURLで渡す（削除前なのでCDN生きてる）
    const files = [...message.attachments.values()].map(att => ({
        attachment: att.url,
        name:       `SPOILER_${att.name || 'image.png'}`,
    }));

    if (message.deletable) await message.delete().catch(() => {});

    const cleanContent = (message.content || '').replace(SENSITIVE_TRIGGER_EMOJI, '').trim();
    const opts = {
        content:         (cleanContent || '\u200b') + hideUserId(message.author.id),
        files,
        username:        message.member?.displayName || message.author.username,
        avatarURL:       message.member?.displayAvatarURL({ dynamic: true }),
        allowedMentions: { parse: ['users'] },
    };
    if (message.channel.isThread()) opts.threadId = message.channel.id;

    await sendWebhook(message.channel, opts);
    return true;
}

/* =========================
   🗑️ 削除 & Webhook再投稿
========================= */
async function instantDeleteAndRecode(message) {
    // ① 削除前にバイナリ確保
    const files = await downloadFiles(message.attachments);

    // ② 削除
    if (message.deletable) await message.delete().catch(() => {});

    // ③ 再投稿
    let finalContent = recodeText(message.content);
    if (!finalContent) finalContent = '*(Message Removed)*';

    const replyPrefix = await buildReplyPrefix(message);
    finalContent = `${replyPrefix}${finalContent}${hideUserId(message.author.id)}`;

    const opts = {
        content:         finalContent,
        files,
        username:        message.member?.displayName || message.author.username,
        avatarURL:       message.member?.displayAvatarURL({ dynamic: true }),
        allowedMentions: { parse: ['users'] },
    };
    if (message.channel.isThread()) opts.threadId = message.channel.id;

    await sendWebhook(message.channel, opts);
}

/* =========================
   🔥 メイン処理
========================= */
async function handleModerator(message) {
    if (!message.content && !message.attachments.size) return;
    if (message.author.bot) return;

    const rawContent = message.content || '';

    if (TUPPERBOX_PREFIX_REGEX.test(rawContent)) return;

    if (checkSpam(message.author.id)) {
        console.warn(`[MOD SPAM] ${message.author.tag}`);
        await message.delete().catch(() => {});
        return;
    }

    const isExempt =
        EXEMPT_ROLES.some(id => message.member?.roles.cache.has(id)) ||
        getModExcludeList().includes(message.author.id);

    const strippedContent  = stripTupperPrefix(rawContent);
    const normalized       = strippedContent.toLowerCase().replace(/\s+/g, '');
    const { hit, matched } = checkNgWords(normalized);

    // テキストがある場合のみAI検査（画像は対象外）
    const aiResult = strippedContent.trim() && !isExempt
        ? await checkAiModeration(strippedContent)
        : { flagged: false, reason: null };

    if (hit && isExempt) {
        console.info(`[MOD EXEMPT] ${message.author.tag} NGワードヒットだが免除: ${matched}`);
    }

    if ((hit || aiResult.flagged) && !isExempt) {
        const allMatched = aiResult.reason ? [...matched, aiResult.reason] : matched;
        logDeletion({ message, matched: allMatched });
        await instantDeleteAndRecode(message);
        return;
    }

    if (await handleSensitivePost(message)) return;
    if (await handlePseudoReply(message))   return;
}

module.exports = { handleModerator };
