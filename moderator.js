// moderator.js
const axios  = require('axios');
const { EmbedBuilder } = require('discord.js');
const { getModExcludeList } = require('./exclude_manager');
const whStore = require('./webhook_store');
const { isCursed } = require('./curse_manager');
const { isImpersonated } = require('./impersonate_manager');
const { isMediaLinkBanned } = require('./medialink_manager');
const { pickOneLurker } = require('./lurker_picker');
const { getLastActivity } = require('./activity_tracker');
const { normalizeForDetection, checkNgWords } = require('./ng_words');
const { DL_CONFIG, downloadFiles, checkAiModeration, checkNsfwImages } = require('./ai_mod');

const ADMIN_ROLE_ID = '1495971497016164492';

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

const DANGEROUS_TO_SAFE_MAP = {
    '\u30ed\u30ea\u7d20\u6750':     '\u8340\u5b50',
    'JK\u7d20\u6750':       '\u8340\u5b50',
    'JC\u7d20\u6750':       '\u8340\u5b50',
    '\u30ea\u30a2\u30ebJK':     '\u97d3\u975e\u5b50',
    '\u751fJK':         '\u97d3\u975e\u5b50',
    '\u5150\u7ae5\u30dd\u30eb\u30ce':   '\u5546\u9785\u5b50',
    '\u5150\u30dd':         '\u5546\u9785\u5b50',
    'csam':         '\u5546\u9785\u5b50',
    '\u63f4\u4ea4':         '\u5442\u4e0d\u97cb',
    '\u30d1\u30d1\u6d3b':       '\u5442\u4e0d\u97cb',
    '\u5bb6\u51faJK':       '\u5442\u4e0d\u97cb',
    '\u5e7c\u5973':         '\u664f\u5b50',
    '\u5973\u5150':         '\u5b5f\u5b50',
    '\u7537\u5150':         '\u5b5f\u5b50',
    '\u5e7c\u5150':         '\u5b54\u5b50',
    '\u5c11\u5973':         '\u8001\u5b50',
    '\u30e9\u30f3\u30c9\u30bb\u30eb':   '\u8358\u5b50',
    '\u30ed\u30ea':         '\u58a8\u5b50',
    '\u308d\u308a':         '\u58a8\u5b50',
    'loli':         '\u58a8\u5b50',
    '\u30b7\u30e7\u30bf':       '\u5b50\u601d',
    '\u3057\u3087\u305f':       '\u5b50\u601d',
    '\u307a\u3069':         '\u9b3c\u8c37\u5b50',
    'JK':           '\u66fe\u5b50',
    'JC':           '\u66fe\u5b50',
    'JS':           '\u66fe\u5b50',
    '\u5973\u5b50\u9ad8\u751f':     '\u66fe\u5b50',
    '\u5973\u5b50\u4e2d\u5b66\u751f':   '\u66fe\u5b50',
    '\u5150\u7ae5':         '\u8cc8\u4f3c\u9053',
};

// JK/JC/JSは単語境界つきで別扱い（URL誤置換防止）
const DANGEROUS_REGEX = new RegExp(
    Object.keys(DANGEROUS_TO_SAFE_MAP)
        .map(k => /^J[KCS]$/i.test(k)
            ? `\\b${k}\\b`
            : k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|'),
    'gi'
);

function sanitizeContent(content, authorId = null) {
    if (!content) return content;
    const { getSettings } = require('./config');
    const settings = getSettings();
    if (!settings.chineseThinkerReplace) return content;
    if (authorId && (settings.chineseThinkerExcludeUsers ?? []).includes(authorId)) return content;
    return content.replace(DANGEROUS_REGEX, match => {
        const lower = match.toLowerCase();
        for (const [key, value] of Object.entries(DANGEROUS_TO_SAFE_MAP)) {
            if (key.toLowerCase() === lower) return value;
        }
        return match;
    });
}

function hasModPermission(member) {
    if (!member) return false;
    if (member.permissions.has('Administrator')) return true;
    if (member.roles.cache.has(ADMIN_ROLE_ID)) return true;
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


async function repostNsfwAsSpoiler(message, reason) {
    const files = [...message.attachments.values()]
        .filter(a => a.contentType?.startsWith('image/') && a.size <= DL_CONFIG.MAX_SIZE)
        .map(att => ({ attachment: att.url, name: `SPOILER_${att.name || 'image.png'}` }));

    if (message.deletable) await message.delete().catch(() => {});

    const replyPrefix  = await buildReplyPrefix(message);
    const bodyText     = sanitizeMentions(message.content || '');
    const finalContent = hideUserId(message.author.id)
        + replyPrefix
        + (bodyText || '​');

    const opts = {
        content:         finalContent,
        files,
        username:        message.member?.displayName || message.author.username,
        avatarURL:       message.member?.displayAvatarURL({ dynamic: true }),
        allowedMentions: { parse: ['users'] },
    };
    if (message.channel.isThread()) opts.threadId = message.channel.id;

    await sendWebhook(message.channel, opts);

    const ts      = new Date().toISOString();
    const tag     = message.author.tag;
    const userId  = message.author.id;
    const channel = message.channel.name ?? message.channelId;
    const urls    = [...message.attachments.values()].map(a => a.url).join(' ');
    console.warn(`[NSFW IMG] ${ts} | #${channel} | ${tag}(${userId}) | reason=${reason} | ${urls}`);
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
            // スレッド削除・アーカイブ済みの場合はリトライ不要
            if (e.code === 10003) {
                console.warn(`[Webhook] Unknown Channel（スレッド消滅？）: ${e.url ?? ''}`);
                return null;
            }
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

    const files        = await downloadFiles(message.attachments);
    const opts = {
        content:         replyContent,
        files,
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
    const safeBody     = sanitizeContent(message.content || '\u200b', message.author?.id);
    const finalContent = hideUserId(message.author.id) + sanitizeMentions(`${replyPrefix}${safeBody}`);

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

    return await sendWebhook(message.channel, opts);
}

const CSAM_LOG_CHANNEL_ID = process.env.CSAM_LOG_CHANNEL_ID || '1511683026948587620';
const CSAM_CATEGORIES     = new Set(['loli_shota', 'age', 'sexual/minors']);

function isCsamMatch(matched) {
    return matched.some(m => CSAM_CATEGORIES.has(m.split('(')[0]));
}

async function postCsamLog(message, matched) {
    if (!CSAM_LOG_CHANNEL_ID || !message.client) return;
    try {
        const ch = await message.client.channels.fetch(CSAM_LOG_CHANNEL_ID);
        if (!ch) return;
        const ts      = new Date().toISOString();
        const userId  = message.author?.id ?? '不明';
        const tag     = message.author?.tag ?? 'unknown';
        const chName  = message.channel?.name ?? message.channelId;
        const preview = (message.content ?? '').slice(0, 300).replace(/\n/g, ' ');
        const attachUrls = [...(message.attachments?.values() ?? [])].map(a => a.url).join(' ');
        const lines = [
            `🚨 **CSAM** \`${ts}\``,
            `👤 <@${userId}> (${tag})`,
            `📢 #${chName}  🔗 ${message.url}`,
            `🏷️ \`${matched.join(', ')}\``,
            preview     ? `💬 ${preview}`     : '',
            attachUrls  ? `🖼️ ${attachUrls}`  : '',
        ].filter(Boolean).join('\n');
        await ch.send({ content: lines, allowedMentions: { parse: [] } });
    } catch (e) {
        console.error('[CSAM LOG] 送信失敗:', e.message);
    }
}

const FOREIGN_LANG_LOG_CHANNEL_ID = process.env.FOREIGN_LANG_LOG_CHANNEL_ID || '1492754541957873734';
const FOREIGNER_ROLE_ID           = process.env.FOREIGNER_ROLE_ID || '1483829668271620146';
const LINGVA_BASE                 = process.env.LINGVA_BASE || 'https://lingva.ml';

async function translateToJa(text) {
    const encoded = encodeURIComponent(text.slice(0, 1000));
    try {
        const res = await axios.get(`${LINGVA_BASE}/api/v1/auto/ja/${encoded}`, { timeout: 6_000 });
        return res.data?.translation ?? null;
    } catch (e) {
        console.error('[TRANSLATE] Lingva失敗:', e.message);
        return null;
    }
}

async function handleForeignerMessage(message) {
    if (!message.member?.roles.cache.has(FOREIGNER_ROLE_ID)) return false;
    if (!message.content?.trim()) return false;
    if (!detectForeignLanguage(message.content)) return false;

    const translated = await translateToJa(message.content);
    if (!translated) return false;

    // 原文・翻訳文の両方でNG/CSAMチェック
    const normalizedOrig  = normalizeForDetection(message.content);
    const normalizedTrans = normalizeForDetection(translated);
    const origCheck  = checkNgWords(normalizedOrig);
    const transCheck = checkNgWords(normalizedTrans);
    const aiCheck    = await checkAiModeration(message.content);

    if (origCheck.hit || transCheck.hit || aiCheck.flagged) {
        const allMatched = [
            ...origCheck.matched,
            ...transCheck.matched,
            ...(aiCheck.reason ? [aiCheck.reason] : []),
        ];
        logDeletion({ message, matched: allMatched });
        if (isCsamMatch(allMatched)) await postCsamLog(message, allMatched);
        if (message.deletable) await message.delete().catch(() => {});
        console.warn(`[TRANSLATE CSAM] ${message.author.tag} 翻訳後にNG検知 → 削除`);
        return true;
    }

    const files      = await downloadFiles(message.attachments);
    if (message.deletable) await message.delete().catch(() => {});

    const embed = new EmbedBuilder()
        .setDescription(`📝 原文:\n${message.content.slice(0, 1000)}`)
        .setColor(0x5865F2)
        .setFooter({ text: '翻訳: Lingva Translate' });

    const replyPrefix  = await buildReplyPrefix(message);
    const finalContent = hideUserId(message.author.id)
        + sanitizeMentions(replyPrefix + translated);

    const opts = {
        content:         finalContent,
        embeds:          [embed],
        files,
        username:        message.member?.displayName || message.author.username,
        avatarURL:       message.member?.displayAvatarURL({ dynamic: true }),
        allowedMentions: { parse: ['users'] },
    };
    if (message.channel.isThread()) opts.threadId = message.channel.id;

    await sendWebhook(message.channel, opts);
    console.info(`[TRANSLATE] ${message.author.tag} → 日本語に自動翻訳`);
    return true;
}

function detectForeignLanguage(text) {
    if (!text?.trim()) return false;

    // 日本語文字（ひらがな・カタカナ・漢字）をカウント
    const jpCount = (text.match(/[぀-ゟ゠-ヿ一-鿿㐀-䶿]/g) ?? []).length;
    if (jpCount >= 5) return false;

    // 記号・数字・空白・絵文字を除いた実質コンテンツ文字列
    const content = text
        .replace(/\p{Emoji}/gu, '')
        .replace(/[\s\d]/g, '')
        .replace(/[！-／：-＠［-｀｛-～、。・「」『』【】〔〕《》〈〉（）\x20-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]/g, '');

    if (content.length < 5) return false;

    // 非ASCII文字（キリル・アラビア・中国語・韓国語等）が5文字以上
    const nonAscii = content.replace(/[A-Za-z]/g, '').replace(/[぀-ゟ゠-ヿ一-鿿㐀-䶿]/g, '');
    if (nonAscii.length >= 5) return true;

    // 英語検知: ラテン文字3文字以上の単語が合計8文字以上（ローマ字混じりと区別）
    const latinWords = text.match(/[A-Za-z]{3,}/g) ?? [];
    const latinLen   = latinWords.reduce((s, w) => s + w.length, 0);
    return latinLen >= 8;
}

async function postForeignLangLog(message) {
    if (!FOREIGN_LANG_LOG_CHANNEL_ID || !message.client) return;
    try {
        const ch = await message.client.channels.fetch(FOREIGN_LANG_LOG_CHANNEL_ID);
        if (!ch) return;
        const tag     = message.author?.tag ?? 'unknown';
        const userId  = message.author?.id ?? '不明';
        const chName  = message.channel?.name ?? message.channelId;
        const preview = (message.content ?? '').slice(0, 300);
        await ch.send({
            content: [
                `🌐 **外国語検知** <@${userId}> (${tag})`,
                `📢 #${chName}  🔗 ${message.url}`,
                `💬 ${preview}`,
            ].join('\n'),
            allowedMentions: { parse: [] },
        });
    } catch (e) {
        console.error('[FOREIGN LOG] 送信失敗:', e.message);
    }
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
   🔗 メディアリンクストリップ
========================= */
const MEDIA_URL_REGEX = /https?:\/\/[^\s<>"]+/gi;

function stripMediaLinks(text) {
    if (!text) return text;
    return text.replace(MEDIA_URL_REGEX, '').replace(/\s{2,}/g, ' ').trim();
}

async function applyMediaLinkStrip(message, strippedContent) {
    const files = await downloadFiles(message.attachments);
    if (message.deletable) await message.delete().catch(() => {});

    const replyPrefix  = await buildReplyPrefix(message);
    const finalContent = hideUserId(message.author.id)
        + sanitizeMentions(replyPrefix + (strippedContent || '​'));

    const opts = {
        content:         finalContent,
        files,
        username:        message.member?.displayName || message.author.username,
        avatarURL:       message.member?.displayAvatarURL({ dynamic: true }),
        allowedMentions: { parse: ['users'] },
    };
    if (message.channel.isThread()) opts.threadId = message.channel.id;

    await sendWebhook(message.channel, opts);
    console.info(`[MEDIALINK] ${message.author.tag}(${message.author.id}) リンクをストリップして再投稿`);
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
    if (!hasRequiredRole) {
        if (!message.content?.trim()) return;
        const normalized = normalizeForDetection(message.content);
        const { hit, matched } = checkNgWords(normalized);
        const aiResult = !hit ? await checkAiModeration(message.content) : { flagged: false, reason: null };
        if (hit || aiResult.flagged) {
            const allMatched = aiResult.reason ? [...matched, aiResult.reason] : matched;
            logDeletion({ message, matched: allMatched });
            if (isCsamMatch(allMatched)) await postCsamLog(message, allMatched);
            await message.delete().catch(() => {});
        }
        return;
    }

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

    // 0〜13の数字単発投稿を規制（添付なし・免除なし）
    if (!isExempt && !message.attachments.size && /^(?:1[0-3]|[0-9])$/.test(strippedContent.trim())) {
        logDeletion({ message, matched: ['single_number(0-13)'] });
        await instantDeleteAndRecode(message);
        return;
    }

    // 画像スキャン（免除なし・テキストNG未ヒット時）ログのみ
    if (!isExempt && !hit && !aiResult.flagged && message.attachments.size > 0) {
        const imgResult = await checkNsfwImages(message.attachments);
        if (imgResult.nsfw) await postCsamLog(message, [`nsfw_image(${imgResult.reason})`]);
    }

    if ((hit || aiResult.flagged) && !isExempt) {
        const allMatched = aiResult.reason ? [...matched, aiResult.reason] : matched;
        logDeletion({ message, matched: allMatched });
        if (isCsamMatch(allMatched)) await postCsamLog(message, allMatched);
        await instantDeleteAndRecode(message);
        return;
    }

    // 外国語検知（免除なし・通過したメッセージのみ）
    if (!isExempt && strippedContent && detectForeignLanguage(strippedContent)) {
        await postForeignLangLog(message);
    }

    if (isMediaLinkBanned(message.author.id, message.channelId) && !isExempt) {
        const stripped = stripMediaLinks(rawContent);
        if (stripped !== rawContent) {
            await applyMediaLinkStrip(message, stripped);
            return;
        }
    }

    if (isCursed(message.author.id) && !isExempt) {
        await applyCurse(message);
        return;
    }

    if (isImpersonated(message.author.id) && !isExempt) {
        await applyImpersonate(message);
        return;
    }

    if (await handleForeignerMessage(message)) return;
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

    const guild  = message.guild;
    const member = guild ? await guild.members.fetch(user.id).catch(() => null) : null;
    const isAdmin  = member?.permissions.has('Administrator') ||
                     member?.roles.cache.has(ADMIN_ROLE_ID);

    // Webhookメッセージはzero-width文字から本来の著者IDを取得
    const realAuthorId = message.webhookId
        ? extractUserId(message.content)
        : message.author?.id;
    const isAuthor = !!realAuthorId && user.id === realAuthorId;

    if (!isAdmin && !isAuthor) return;

    // 管理者以外は投稿から30分以内のみ許可
    const CRY_TIME_LIMIT_MS = 30 * 60 * 1000;
    if (!isAdmin && Date.now() - message.createdTimestamp > CRY_TIME_LIMIT_MS) return;

    await reaction.remove().catch(() => {});

    const files = await downloadFiles(message.attachments);

    let finalContent, username, avatarURL;
    if (message.webhookId) {
        // すでにWebhookメッセージ: コンテンツ・名前・アイコンをそのまま引き継ぐ
        finalContent = message.content || '\u200b';
        username     = message.author.username;
        avatarURL    = message.author.displayAvatarURL({ dynamic: true });
    } else {
        const msgMember = message.member
            ?? await message.guild?.members.fetch(message.author.id).catch(() => null);
        const replyPrefix = await buildReplyPrefix(message);
        const content     = sanitizeMentions(message.content || '');
        finalContent = hideUserId(message.author.id) + replyPrefix + (content || '\u200b');
        username     = msgMember?.displayName || message.author.username;
        avatarURL    = msgMember?.displayAvatarURL({ dynamic: true })
                    ?? message.author.displayAvatarURL({ dynamic: true });
    }

    const opts = {
        content:         finalContent,
        files,
        username,
        avatarURL,
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