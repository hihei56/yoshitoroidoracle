// moderator.js
const axios  = require('axios');
const { OpenAI } = require('openai');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getModExcludeList } = require('./exclude_manager');
const whStore = require('./webhook_store');
const { isCursed } = require('./curse_manager');
const { isImpersonated } = require('./impersonate_manager');
const { pickOneLurker } = require('./lurker_picker');
const { getLastActivity } = require('./activity_tracker');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EXEMPT_ROLES = [
    '1486178659130933278',
    '1477024387524857988',
];
const REQUIRED_ROLES = [
    '1478715790575538359',
    '1476944370694488134',
];
const SENSITIVE_ALLOWED_ROLES = [
    '1486178659130933278',
    '1477024387524857988',
];
const ALLOWED_ROLES           = ['1476944370694488134', '1478715790575538359'];
const SENSITIVE_TRIGGER_EMOJI = '👶';
const TUPPERBOX_APP_ID        = '431544605209788416';
const TUPPERBOX_PREFIX_REGEX  = /^([a-zA-Z]+!)(.*)$/;

// ─── ゼロ幅文字エンコード ───
const ZERO_WIDTH_MAP     = { '0': '\u200B', '1': '\u200C' };
const REVERSE_ZERO_WIDTH = { '\u200B': '0', '\u200C': '1' };
const ZERO_WIDTH_SEP     = '\u200D';

function hideUserId(userId) {
    return [...BigInt(userId).toString(2)].map(b => ZERO_WIDTH_MAP[b]).join('');
}

function hideUserIds(authorId, lurkerId) {
    const encoded = hideUserId(authorId);
    if (!lurkerId) return encoded;
    return encoded + ZERO_WIDTH_SEP + hideUserId(lurkerId);
}

function extractUserIds(text) {
    if (!text) return { authorId: null, displayId: null };
    const bits = [];
    for (const c of text) {
        if (REVERSE_ZERO_WIDTH[c]) bits.push(REVERSE_ZERO_WIDTH[c]);
        else break;
    }
    if (!bits.length) return { authorId: null, displayId: null };
    try {
        const authorId = BigInt('0b' + bits.join('')).toString();
        const rest = [...text].slice(bits.length);
        if (rest[0] !== ZERO_WIDTH_SEP) return { authorId, displayId: authorId };
        const lurkerBits = [];
        for (const c of rest.slice(1)) {
            if (REVERSE_ZERO_WIDTH[c]) lurkerBits.push(REVERSE_ZERO_WIDTH[c]);
            else break;
        }
        if (!lurkerBits.length) return { authorId, displayId: authorId };
        const lurkerId = BigInt('0b' + lurkerBits.join('')).toString();
        return { authorId, displayId: lurkerId };
    } catch { return { authorId: null, displayId: null }; }
}

function extractUserId(text) {
    return extractUserIds(text).authorId;
}

function sanitizeMentions(text) {
    if (!text) return text;
    return text
        .replace(/@everyone/g, '@\u200beveryone')
        .replace(/@here/g,     '@\u200bhere');
}

function hasModPermission(member) {
    if (!member) return false;
    if (member.permissions.has('Administrator')) return true;
    return ALLOWED_ROLES.some(id => member.roles.cache.has(id));
}

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

function normalizeForDetection(text) {
    if (!text) return '';
    return text
        .replace(/[！-～]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
        .replace(/[\u200B-\u200F\u2060\u2061\uFEFF\u00AD]/g, '')
        .toLowerCase()
        .replace(/[\s\u3000_\-.,。、・「」『』【】〔〕《》〈〉（）()\[\]{}*★☆◆◇●○]/g, '');
}

const LOLI_SHOTA_REGEX = new RegExp([
    'ロリ','ろり','ﾛﾘ','loli',
    'ショタ','しょた','ｼｮﾀ','shota',
    'ロリコン','ろりこん','lolicon',
    'ショタコン','しょたこん','shotacon',
    '幼女','幼男','キッズ',
    '小学生','中学生','小学校','中学校',
    'ペド','ぺど',
    'p\\W*e\\W*d\\W*o',
    '小児性愛','幼児性愛','小児愛',
    'ペドフィリア','ペドフィール',
    '援交','えんこう','援助交際',
    '児童ポルノ','児童買春','児童わいせつ',
    '幼児わいせつ','幼児淫行',
    'csam',
    'child\\W*porn','child\\W*abuse\\W*mater',
    'エプスタイン','🧒','👧','👦','🍼','🎒',
    '児童','未成年',
    'ガキ','がき',
    '女児','男児','幼児',
    '乳児','乳幼児','園児','新生児',
    '女子小学生','女子中学生','じょしこうせい',
    'おさな(?:妻|い子)',
    '年端もいかない',
    'cp',
    'minor',
    'map(?:community|pride|flag)',
    'hebephil','ephebophil',
    '少女',
    '少年愛',
    '児ポ',
    '制服',
    '体操着',
    '水着',
    'ランドセル',
    '放課後',
    'jailbait',
    'preteen',
    'underage',
    'child\\s*(?:sex|sexual|molest|abuse|exploit)',
    'JK','JC','JS',
].join('|'), 'i');

const AGE_REGEX = new RegExp([
    '(?:[0-9]|1[0-2])(?:歳|才|さい)',
    '(?:[０-９]|１[０-２])(?:歳|才|さい)',
    '(?:一|二|三|四|五|六|七|八|九|十|十一|十二)(?:歳|才|さい)',
    '13歳未満','小[1-6]','中[1-3]',
    '(?:[1-9]|1[0-2])\\s*(?:yo|y\\/o|year\\W*old)',
    'u\\s*18',
].join('|'), 'i');

const THREAT_REGEX = new RegExp([
    '殺','死ね','しね','死ねよ','死んでしまえ',
    '殺す','ころす','殺してやる','殺すぞ','ぶっ殺',
    '爆破','爆殺','刺す','刺してやる','刺すぞ',
    '銃',
    'kill\\s*you',"i'?ll\\s*kill",'gonna\\s*kill','want\\s*(?:you\\s*)?dead',
    '自殺しろ','死んでください','死んでほしい','死んでくれ',
    'テロ',
    '大量虐殺',
    'mass\\s*shoot(?:ing)?',
    'school\\s*shoot(?:ing)?',
    '無差別殺人','無差別テロ','無差別攻撃',
].join('|'), 'i');

const DRUG_REGEX = new RegExp([
    '覚醒剤','覚せい剤','MDM[Aa]','コカイン','ヘロイン',
    '大麻','マリファナ','危険ドラッグ','脱法ドラッグ',
    'シャブ','やく',
    'drug',
].join('|'), 'i');

const SELF_HARM_PROMO_REGEX = new RegExp([
    '首吊り',
    '首を吊る',
    '飛び降り',
    '自殺',
    '死に方',
    '楽に死ぬ',
    '安楽死',
    'od',
    '睡眠薬',
    '過剰摂取',
    'リストカット',
    'リスカ',
    '練炭自殺',
    '入水自殺',
    '焼身自殺',
    '電車に飛び込む',
    '死にたい','死のう','死んでしまいたい','死にたくなった',
    '生きていたくない',
    '生きてる意味',
    '消えてしまいたい',
    'suicide',
    'kill\\s*myself',
    'commit\\s*suicide',
].join('|'), 'i');

const HATE_REGEX = new RegExp([
    'チャンコロ',
    'チョンコ',
    'チョン',
    '支那',
    '在日',
    '民族浄化','人種浄化',
    '生きるに値しない命',
    '生きる価値ない',
    'nigger','nigga',
    'n\\s*[-_]\\s*word',
    'ニガー','ニガ',
    '黒人(?:死ね|消えろ|猿|ゴミ|クズ)',
    'kike',
    'ユダヤ',
    'ホロコースト(?:は嘘|なかった|否定)',
    'holocaust\\s*(?:denial|lie|fake|hoax)',
    'antisemit',
    'white\\s*power','white\\s*supremac','white\\s*nationalist',
    'heil\\s*hitler',
    'ハイル\\s*ヒトラー',
    'ナチス',
    '14\\s*words',
    '88\\s*(?:heil|万歳)',
    'white\\s*lives\\s*matter',
    'chink','チンク',
    'gook',
    '朝鮮人(?:ゴキブリ|害虫|猿|死ね|消えろ)',
    '韓国人(?:ゴキブリ|害虫|猿|死ね|消えろ)',
    'シナ人',
    'jap',
    'towelhead','raghead',
    'sand\\s*n(?:igger|igga)',
    'camel\\s*jockey',
    'ethnic\\s*cleansing',
    'race\\s*war',
    'genocide',
    '外国人排斥','移民排斥','外国人駆逐',
    '売国',
    'spic','beaner','wetback',
    'slope','zipperhead',
    'curry\\s*(?:muncher|nigger)',
    'paki',
    'ゲイ','げい',
    'レズ','れず','レズビアン',
    'ホモ','ほも',
    'オカマ','おかま','お釜','オネエ',
    'ニューハーフ','ﾆｭｰﾊｰﾌ',
    'オナベ','おなべ',
    'バイセクシャル','バイセクシュアル',
    'クィア','クエスチョニング',
    'トランスジェンダー','トランスセクシャル',
    'LGBT','LGBTQ',
    '同性愛',
    'ふたなり',
].join('|'), 'i');

const DISABILITY_HATE_REGEX = new RegExp([
    'かたわ',
    'びっこ',
    'めくら',
    'つんぼ',
    'いざり',
    '知恵遅れ',
    'ガイジ',
    'ハッタショ',
    'アスペ',
    'スペ',
    'キチガイ','きちがい',
    '基地外',
    'メンヘラ',
    '精神異常',
    'キ○ガイ','キ◯ガイ',
    'retard',
    'spastic',
    'mental(?:ly)?\\s*retard',
].join('|'), 'i');

function checkNgWords(text) {
    const matched = [];
    function testAndCapture(regex, label) {
        const m = text.match(regex);
        if (m) matched.push(`${label}(${m[0].slice(0, 20)})`);
    }
    testAndCapture(LOLI_SHOTA_REGEX,     'loli_shota');
    testAndCapture(AGE_REGEX,             'age');
    testAndCapture(THREAT_REGEX,         'threat');
    testAndCapture(DRUG_REGEX,           'drug');
    testAndCapture(SELF_HARM_PROMO_REGEX, 'self_harm_promo');
    testAndCapture(HATE_REGEX,           'hate_speech');
    testAndCapture(DISABILITY_HATE_REGEX, 'disability_hate');
    return { hit: matched.length > 0, matched };
}

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
        } catch {}
    }
    return files;
}

const AI_THRESHOLDS = {
    'sexual/minors':            0.20,
    'hate':                     0.60,
    'hate/threatening':         0.55,
    'harassment':               0.80,
    'harassment/threatening':   0.70,
    'self-harm':                0.70,
    'self-harm/intent':         0.55,
    'self-harm/instructions':   0.45,
    'sexual':                   0.90,
    'violence':                 0.88,
    'violence/graphic':         0.80,
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

function logDeletion({ message, matched }) {
    const ts      = new Date().toISOString();
    const tag     = message.author.tag;
    const userId  = message.author.id;
    const channel = message.channel.name ?? message.channelId;
    const preview = (message.content ?? '').slice(0, 200).replace(/\n/g, ' ');
    console.warn(`[MOD] ${ts} | #${channel} | ${tag}(${userId}) | matched=${JSON.stringify(matched)} | "${preview}"`);
}

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
   📍 Webhook管理
========================= */
const webhookCache    = new Map();
const webhookPromises = new Map();

async function getOrCreateWebhook(channel) {
    const target = channel.isThread() ? channel.parent : channel;
    if (!target) return null;
    const key = target.id;

    const cached = webhookCache.get(key);
    if (cached) return cached.wh;

    if (webhookPromises.has(key)) return webhookPromises.get(key);

    const promise = (async () => {
        const stored = whStore.get(key);
        if (stored) {
            webhookCache.set(key, { wh: stored });
            return stored;
        }
        try {
            const hooks = await target.fetchWebhooks();
            let wh = hooks.find(h => h.token);
            if (!wh) wh = await target.createWebhook({ name: 'Moderator' });
            whStore.set(key, wh);
            webhookCache.set(key, { wh });
            return wh;
        } catch (e) {
            console.error(`[Webhook] 取得失敗: ${e.message}`);
            return null;
        }
    })();

    webhookPromises.set(key, promise);
    promise.finally(() => webhookPromises.delete(key));
    return promise;
}

function invalidateWebhook(channelId) {
    webhookCache.delete(channelId);
    whStore.remove(channelId);
}

async function sendWebhook(channel, options) {
    const target = channel.isThread() ? channel.parent : channel;
    const key    = target?.id;

    const NET_DELAYS = [1_000, 3_000, 8_000];

    for (let attempt = 0; attempt <= NET_DELAYS.length; attempt++) {
        const wh = await getOrCreateWebhook(channel);
        if (!wh) return null;
        try {
            return await wh.send(options);
        } catch (e) {
            const isWebhookGone = e.status === 404 || e.code === 10015;
            if (isWebhookGone) {
                if (key) invalidateWebhook(key);
                console.warn('[Webhook] Webhook削除検知 → 再作成中...');
                const newWh = await getOrCreateWebhook(channel);
                if (!newWh) return null;
                try { return await newWh.send(options); }
                catch (e2) { console.error(`[Webhook] 再作成後も失敗: ${e2.message}`); return null; }
            }
            if (key) webhookCache.delete(key);
            const isLast = attempt === NET_DELAYS.length;
            if (isLast) { console.error(`[Webhook] 投稿失敗（全リトライ消化）: ${e.message}`); return null; }
            console.warn(`[Webhook] 投稿失敗 attempt${attempt + 1}, ${NET_DELAYS[attempt]}ms後リトライ: ${e.message}`);
            await new Promise(r => setTimeout(r, NET_DELAYS[attempt]));
        }
    }
}

const QUOTE_MAX = 17;

async function buildReplyPrefix(message) {
    if (!message.reference?.messageId) return '';
    try {
        const ref = await message.channel.messages.fetch(message.reference.messageId);
        let targetId = ref.author.id;

        if (ref.webhookId) {
            const { authorId, displayId } = extractUserIds(ref.content);
            if (authorId) {
                if (displayId && displayId !== authorId) {
                    targetId = displayId;
                } else if (isImpersonated(authorId)) {
                    const lurker = await _getImpersonateLurker(message.guild);
                    targetId = lurker?.id ?? authorId;
                } else {
                    targetId = authorId;
                }
            }
        }

        let body = [...(ref.content || '')]
            .filter(c => !REVERSE_ZERO_WIDTH[c] && c !== ZERO_WIDTH_SEP)
            .join('')
            .trim();

        if (ref.webhookId) {
            const lines = body.split('\n');
            const firstNonQuote = lines.findIndex(l => !l.startsWith('>'));
            if (firstNonQuote > 0) {
                body = lines.slice(firstNonQuote).join('\n').trim();
            } else if (lines[0]?.startsWith('[Reply to:]')) {
                body = lines.slice(2).join('\n').trim();
            }
        }

        const preview = body.length > QUOTE_MAX
            ? body.substring(0, QUOTE_MAX).replace(/\n/g, ' ') + '…'
            : body.replace(/\n/g, ' ');

        const channelId = ref.channelId ?? message.channelId;
        const jumpUrl   = `https://discord.com/channels/${message.guildId}/${channelId}/${ref.id}`;
        return `> [Reply to:](${jumpUrl}) <@${targetId}>\n> ${preview}\n`;
    } catch { return ''; }
}

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
    const replyContent = hideUserId(message.author.id) + sanitizeMentions(`${replyPrefix}${recodeText(message.content)}`);

    let username  = message.member?.displayName || message.author.username;
    let avatarURL = message.member?.displayAvatarURL({ dynamic: true });

    if (isImpersonated(message.author.id)) {
        const lurker = await _getImpersonateLurker(message.guild);
        if (lurker) {
            username  = lurker.displayName || lurker.user.username;
            avatarURL = lurker.user.displayAvatarURL({ dynamic: true });
        }
    }

    const opts = {
        content:         replyContent,
        files:           [],
        username,
        avatarURL,
        allowedMentions: { parse: ['users'] },
    };
    if (message.channel.isThread()) opts.threadId = message.channel.id;

    await sendWebhook(message.channel, opts);
    return true;
}

async function handleSensitivePost(message) {
    const hasPerm = SENSITIVE_ALLOWED_ROLES.some(id => message.member?.roles.cache.has(id));
    if (!hasPerm) return false;

    const hasTrigger = message.content?.includes(SENSITIVE_TRIGGER_EMOJI);
    const hasAttach  = message.attachments.size > 0;
    if (!hasTrigger || !hasAttach) return false;

    const files = [...message.attachments.values()].map(att => ({
        attachment: att.url,
        name:       `SPOILER_${att.name || 'image.png'}`,
    }));

    if (message.deletable) await message.delete().catch(() => {});

    const cleanContent = (message.content || '').replace(SENSITIVE_TRIGGER_EMOJI, '').trim();
    const opts = {
        content:         hideUserId(message.author.id) + sanitizeMentions(cleanContent || '\u200b'),
        files,
        username:        message.member?.displayName || message.author.username,
        avatarURL:       message.member?.displayAvatarURL({ dynamic: true }),
        allowedMentions: { parse: ['users'] },
    };
    if (message.channel.isThread()) opts.threadId = message.channel.id;

    await sendWebhook(message.channel, opts);
    return true;
}

async function instantDeleteAndRecode(message) {
    const files = await downloadFiles(message.attachments);
    if (message.deletable) await message.delete().catch(() => {});

    const replyPrefix  = await buildReplyPrefix(message);
    const finalContent = hideUserId(message.author.id) + sanitizeMentions(`${replyPrefix}${message.content || '\u200b'}`);

    let username  = message.member?.displayName || message.author.username;
    let avatarURL = message.member?.displayAvatarURL({ dynamic: true });

    if (isImpersonated(message.author.id)) {
        const lurker = await _getImpersonateLurker(message.guild);
        if (lurker) {
            username  = lurker.displayName || lurker.user.username;
            avatarURL = lurker.user.displayAvatarURL({ dynamic: true });
        }
    }

    const opts = {
        content:         finalContent,
        files,
        username,
        avatarURL,
        allowedMentions: { parse: ['users'] },
    };
    if (message.channel.isThread()) opts.threadId = message.channel.id;

    await sendWebhook(message.channel, opts);
}

/* =========================
   🎭 lurker取得（lurker_picker.js に統一）
========================= */
let _lastLurkerId = null;

async function _getImpersonateLurker(guild) {
    const { member } = await pickOneLurker(guild, { lastPickedId: _lastLurkerId });
    if (member) _lastLurkerId = member.id;
    return member;
}

/* =========================
   👹 呪い文字化け処理
========================= */
const CORRUPT_CHARS = 'ﾊﾋﾌﾍﾎﾄｱｲｳｴｵｦｧｭｮｯｰｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ░▒▓│┤╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀';
const ZALGO_MARKS  = [...'̴̷̸̡̢̨̧̛̍̎̄̅̿̑̒̓̔̽̾̈́͐͑͒͗͛ͅ'];

function garbleText(text, rate) {
    const r = rate ?? (0.30 + Math.random() * 0.10);
    return [...text].map(c => {
        if (c === '\n') return c;
        const roll = Math.random();
        if (roll < r) {
            return CORRUPT_CHARS[Math.floor(Math.random() * CORRUPT_CHARS.length)];
        }
        if (roll < r + 0.12) {
            const n = Math.floor(Math.random() * 3) + 1;
            return c + ZALGO_MARKS.slice(0, n).join('');
        }
        return c;
    }).join('');
}

function garbleName(name) {
    return garbleText(name, 0.50);
}

async function applyCurse(message) {
    const files = await downloadFiles(message.attachments);
    if (message.deletable) await message.delete().catch(() => {});

    const garbledContent = garbleText(sanitizeMentions(message.content || '\u200b'));
    const garbledName    = garbleName(message.member?.displayName || message.author.username);
    const avatarURL      = message.member?.displayAvatarURL({ dynamic: true, size: 16 }) ?? undefined;
    const replyPrefix    = await buildReplyPrefix(message);

    const opts = {
        content:         hideUserId(message.author.id) + replyPrefix + garbledContent,
        files,
        username:        garbledName,
        avatarURL,
        allowedMentions: { parse: [] },
    };
    if (message.channel.isThread()) opts.threadId = message.channel.id;

    await sendWebhook(message.channel, opts);
    console.info(`[CURSE] ${message.author.tag}(${message.author.id}) メッセージを文字化け再投稿`);
}

/* =========================
   🎭 なりすまし処理
========================= */
async function applyImpersonate(message) {
    const files = await downloadFiles(message.attachments);
    if (message.deletable) await message.delete().catch(() => {});

    const lurker      = await _getImpersonateLurker(message.guild);
    const replyPrefix = await buildReplyPrefix(message);
    const bodyText    = sanitizeMentions(message.content || '\u200b');
    const hiddenIds   = hideUserIds(message.author.id, lurker?.id ?? null);

    const opts = {
        content:         hiddenIds + replyPrefix + bodyText,
        files,
        username:        lurker?.displayName || lurker?.user?.username || '匿名',
        avatarURL:       lurker?.user?.displayAvatarURL({ dynamic: true }) ?? undefined,
        allowedMentions: { parse: ['users'] },
    };
    if (message.channel.isThread()) opts.threadId = message.channel.id;

    await sendWebhook(message.channel, opts);
    console.info(`[IMPERSONATE] ${message.author.tag}(${message.author.id}) → ${lurker?.user?.tag ?? 'フォールバック'}(${lurker?.id})`);
}

/* =========================
   📨 /imp メッセージへのリプライ処理
   リプライ先が /imp Webhook（authorId != displayId）の場合、
   返信者の名前・アイコンそのままでWebhook再送し、lurkerIDにメンションを飛ばす
========================= */
async function handleImpReply(message) {
    if (!message.reference?.messageId) return false;

    const ref = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (!ref?.webhookId) return false;

    const { authorId, displayId } = extractUserIds(ref.content);
    // displayId !== authorId のとき = /imp メッセージ（lurkerIDが埋め込まれている）
    if (!authorId || !displayId || displayId === authorId) return false;

    const files = await downloadFiles(message.attachments);
    if (message.deletable) await message.delete().catch(() => {});

    const replyPrefix  = await buildReplyPrefix(message);
    const finalContent = hideUserId(message.author.id)
        + sanitizeMentions(replyPrefix + (message.content || '\u200b'));

    const opts = {
        content:         finalContent,
        files,
        username:        message.member?.displayName || message.author.username,
        avatarURL:       message.member?.displayAvatarURL({ dynamic: true }),
        allowedMentions: { parse: ['users'] },
    };
    if (message.channel.isThread()) opts.threadId = message.channel.id;

    await sendWebhook(message.channel, opts);
    console.info(`[IMP_REPLY] ${message.author.tag}(${message.author.id}) → lurker<@${displayId}> にリプライ`);
    return true;
}

async function handleModerator(message) {
    if (!message.content && !message.attachments.size) return;
    if (message.author.bot) return;

    const hasRequiredRole = REQUIRED_ROLES.some(id => message.member?.roles.cache.has(id));
    if (!hasRequiredRole) return;

    const rawContent = message.content || '';
    if (TUPPERBOX_PREFIX_REGEX.test(rawContent)) return;

    if (checkSpam(message.author.id)) {
        console.warn(`[MOD SPAM] ${message.author.tag}`);
        await message.delete().catch(() => {});
        return;
    }

    const excl     = getModExcludeList();
    const isExempt =
        EXEMPT_ROLES.some(id => message.member?.roles.cache.has(id)) ||
        excl.users.includes(message.author.id) ||
        excl.roles.some(roleId => message.member?.roles.cache.has(roleId));

    const strippedContent  = stripTupperPrefix(rawContent);
    const normalized       = normalizeForDetection(strippedContent);
    const { hit, matched } = checkNgWords(normalized);

    const aiResult = strippedContent.trim() && !isExempt && !hit
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

    if (isCursed(message.author.id) && !isExempt) {
        await applyCurse(message);
        return;
    }

    if (isImpersonated(message.author.id) && !isExempt) {
        await applyImpersonate(message);
        return;
    }

    if (await handleSensitivePost(message)) return;
    if (await handleImpReply(message))      return; // ← /imp メッセージへのリプライ判定
    if (await handlePseudoReply(message))   return;
}

/* =========================
   💩 / ❌ リアクション削除
========================= */
async function handlePoopReaction(reaction, user) {
    if (user.bot) return;
    if (!['💩', '❌'].includes(reaction.emoji.name)) return;

    if (reaction.partial) await reaction.fetch().catch(() => {});
    const message = reaction.message.partial
        ? await reaction.message.fetch().catch(() => null)
        : reaction.message;
    if (!message?.webhookId) return;

    const authorId = extractUserId(message.content);
    if (!authorId || user.id !== authorId) return;

    await message.delete().catch(() => {});
    console.info(`[${reaction.emoji.name}] ${user.tag}(${user.id}) が自分のWebhookメッセージを削除`);
}

/* =========================
   😿 リアクション → Webhook化
========================= */
async function handleCryReaction(reaction, user) {
    if (user.bot) return;
    if (reaction.emoji.name !== '😿') return;

    if (reaction.partial) await reaction.fetch().catch(() => {});
    const message = reaction.message.partial
        ? await reaction.message.fetch().catch(() => null)
        : reaction.message;
    if (!message) return;

    if (message.webhookId) return;

    const CRY_ALLOWED_ROLES = ['1495971497016164492'];
    const guild  = message.guild;
    const member = guild ? await guild.members.fetch(user.id).catch(() => null) : null;
    const isAdmin  = member?.permissions.has('Administrator') ||
                     CRY_ALLOWED_ROLES.some(id => member?.roles.cache.has(id));
    const isAuthor = user.id === message.author?.id;

    if (!isAdmin && !isAuthor) return;

    await reaction.remove().catch(() => {});

    const files       = await downloadFiles(message.attachments);
    const replyPrefix = await buildReplyPrefix(message);
    const content     = sanitizeMentions(message.content || '');
    const finalContent = hideUserId(message.author.id) + replyPrefix + (content || '\u200b');

    const opts = {
        content:         finalContent,
        files,
        username:        message.member?.displayName || message.author.username,
        avatarURL:       message.member?.displayAvatarURL({ dynamic: true }),
        allowedMentions: { parse: ['users'] },
    };
    if (message.channel.isThread()) opts.threadId = message.channel.id;

    if (message.deletable) await message.delete().catch(() => {});
    await sendWebhook(message.channel, opts);

    console.info(`[😿] ${user.tag}(${user.id}) が ${message.author.tag} のメッセージをWebhook化`);
}

/* =========================
   🔗 embed検閲（MessageUpdate）
========================= */
async function handleEmbedModerator(oldMessage, newMessage) {
    if (newMessage.partial) {
        try { await newMessage.fetch(); } catch { return; }
    }
    if (!newMessage.guild) return;
    if (newMessage.author?.bot) return;

    const newEmbeds = newMessage.embeds ?? [];
    if (newEmbeds.length === 0) return;

    // oldが未キャッシュ(partial)なら[]扱い、増えたときだけ処理
    const oldEmbeds = oldMessage.partial ? [] : (oldMessage.embeds ?? []);
    if (newEmbeds.length <= oldEmbeds.length) return;

    const member = newMessage.member
        ?? await newMessage.guild.members.fetch(newMessage.author.id).catch(() => null);
    if (!member) return;

    const hasRequiredRole = REQUIRED_ROLES.some(id => member.roles.cache.has(id));
    if (!hasRequiredRole) return;

    const excl = getModExcludeList();
    const isExempt =
        EXEMPT_ROLES.some(id => member.roles.cache.has(id)) ||
        excl.users.includes(newMessage.author.id) ||
        excl.roles.some(roleId => member.roles.cache.has(roleId));
    if (isExempt) return;

    // 新たに増えたembedだけ対象
    const addedEmbeds = newEmbeds.slice(oldEmbeds.length);
    const embedText = addedEmbeds.flatMap(e => [
        e.title,
        e.description,
        ...(e.fields ?? []).map(f => `${f.name} ${f.value}`),
        e.author?.name,
        e.footer?.text,
    ]).filter(Boolean).join('\n');

    if (!embedText.trim()) return;

    const normalized = normalizeForDetection(embedText);
    const { hit, matched } = checkNgWords(normalized);

    const aiResult = !hit
        ? await checkAiModeration(embedText)
        : { flagged: false, reason: null };

    if (!hit && !aiResult.flagged) return;

    const allMatched = aiResult.reason ? [...matched, aiResult.reason] : matched;
    logDeletion({ message: newMessage, matched: allMatched });
    await instantDeleteAndRecode(newMessage);
}

module.exports = {
    handleModerator,
    handlePoopReaction,
    handleCryReaction,
    handleEmbedModerator,
};