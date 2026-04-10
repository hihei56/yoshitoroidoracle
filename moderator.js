// moderator.js — 最終版
const axios  = require('axios');
const { OpenAI } = require('openai');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getModExcludeList } = require('./exclude_manager');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    'ろ\\W*り','しょ\\W*た',
    'l\\W*o\\W*l\\W*i','s\\W*h\\W*o\\W*t\\W*a',
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
].join('|'), 'i');

const AGE_REGEX = new RegExp([
    '(?<![0-9０-９])(?:[0-9]|1[0-2])(?:歳|才|さい)',
    '(?<![0-9０-９])(?:[０-９]|１[０-２])(?:歳|才|さい)',
    '(?:一|二|三|四|五|六|七|八|九|十|十一|十二)(?:歳|才|さい)',
    '13歳未満','小[1-6]','中[1-3]',
    '(?<![0-9])(?:[1-9]|1[0-2])\\s*(?:yo|y\\/o|year\\W*old)',
    'u\\s*18(?![0-9])',
].join('|'), 'i');

const THREAT_REGEX = new RegExp([
    '殺','死ね','しね','殺す','ころす','殺してやる',
    '爆破','爆殺','刺す','刺してやる',
    'kill\\s*you',"i'?ll\\s*kill",'gonna\\s*kill',
    '自殺しろ','死んでください',
    'テロ(?:を起こせ|しろ|実行)',
    '大量虐殺(?:しろ|せよ|万歳)',
    'mass\\s*shoot(?:ing)?',
].join('|'), 'i');

const DRUG_REGEX = new RegExp([
    '覚醒剤','覚せい剤','MDM[Aa]','コカイン','ヘロイン',
    '大麻','マリファナ','危険ドラッグ','脱法ドラッグ',
    'シャブ','やく(?:を|買|売|やる)',
    'drug\\s*deal','sell\\s*drug',
].join('|'), 'i');

const SELF_HARM_PROMO_REGEX = new RegExp([
    '首吊り(?:方法|やり方|場所|ひも|紐|ロープ|のしかた)',
    '首を吊る(?:方法|やり方)',
    '飛び降り(?:方法|やり方|場所|名所|スポット)',
    '飛び降りる(?:場所|方法)',
    '自殺(?:方法|のやり方|のしかた|の仕方|名所|スポット|する方法)',
    '死に方(?:を教|教えて)',
    '楽に死ぬ(?:方法|には)',
    '安楽死(?:方法|のやり方)',
    'od(?:の仕方|やり方|方法|量|して死)',
    '睡眠薬(?:で死|を飲んで死)',
    '過剰摂取(?:の量|方法|のやり方)',
    'リストカット(?:の仕方|方法|やり方)',
    'リスカ(?:の仕方|方法)',
    '練炭自殺',
    '入水自殺(?:場所|方法)',
    '焼身自殺(?:の仕方|方法)',
    '電車(?:に飛び込む|で自殺)(?:方法|場所)',
].join('|'), 'i');

const HATE_REGEX = new RegExp([
    'チャンコロ',
    'チョンコ',
    '支那(?:人め|め|野郎|女め)',
    '(?:外国人|移民|難民|在日)(?:は|を)?(?:出て(?:いけ|行け|ろ)|追い出せ|帰れ(?:よ|！|$)|殺せ)',
    '(?:ゴキブリ|害虫|寄生虫)(?:外国人|移民|在日)',
    '(?:外国人|移民|在日)(?:ゴキブリ|害虫|寄生虫)',
    '(?:ムスリム|イスラム|ユダヤ|LGBT|障害者)(?:は)?(?:消えろ|いなくなれ|死ね|殺せ)',
    '(?:人種|民族|外国人)(?:を)?(?:浄化|根絶|駆逐)',
    '生きるに値しない命',
    '生きる価値(?:の)?ない(?:命|人間|存在)',
    '(?:障害者|精神障害者|知的障害者)(?:は)?(?:生きる価値がない|社会のお荷物|不要な存在)',
    '(?:ゲイ|同性愛者|LGBT)(?:で)?(?:黒人|外国人|ユダヤ)',
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
    'スペ(?:め|かよ|すぎ|だろ|だな|ども)',
].join('|'), 'i');

function checkNgWords(text) {
    const matched = [];
    if (LOLI_SHOTA_REGEX.test(text))       matched.push('loli_shota');
    if (AGE_REGEX.test(text))              matched.push('age');
    if (THREAT_REGEX.test(text))           matched.push('threat');
    if (DRUG_REGEX.test(text))             matched.push('drug');
    if (SELF_HARM_PROMO_REGEX.test(text))  matched.push('self_harm_promo');
    if (HATE_REGEX.test(text))             matched.push('hate_speech');
    if (DISABILITY_HATE_REGEX.test(text))  matched.push('disability_hate');
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
    'sexual/minors':            0.3,
    'hate':                     0.75,
    'hate/threatening':         0.70,
    'harassment':               0.85,
    'harassment/threatening':   0.80,
    'self-harm':                0.80,
    'self-harm/intent':         0.70,
    'self-harm/instructions':   0.60,
    'sexual':                   0.92,
    'violence':                 0.90,
    'violence/graphic':         0.85,
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
    const preview = (message.content ?? '').slice(0, 80).replace(/\n/g, ' ');
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

const webhookCache    = new Map();
const webhookPromises = new Map();
const WEBHOOK_CACHE_TTL = 24 * 60 * 60 * 1000;

async function getOrCreateWebhook(channel) {
    const target = channel.isThread() ? channel.parent : channel;
    if (!target) return null;
    const key = target.id;

    const cached = webhookCache.get(key);
    if (cached && Date.now() - cached.timestamp < WEBHOOK_CACHE_TTL) return cached.webhook;

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
    const replyContent = sanitizeMentions(`${replyPrefix}${recodeText(message.content)}`) + hideUserId(message.author.id);

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
        content:         sanitizeMentions(cleanContent || '\u200b') + hideUserId(message.author.id),
        files,
        components:      [buildDeleteButtonRow(message.author.id)],
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
    const finalContent = sanitizeMentions(`${replyPrefix}${message.content || '\u200b'}`) + hideUserId(message.author.id);

    const opts = {
        content:         finalContent,
        files,
        components:      hasImageAttachment(message.attachments) ? [buildDeleteButtonRow(message.author.id)] : [],
        username:        message.member?.displayName || message.author.username,
        avatarURL:       message.member?.displayAvatarURL({ dynamic: true }),
        allowedMentions: { parse: ['users'] },
    };
    if (message.channel.isThread()) opts.threadId = message.channel.id;

    await sendWebhook(message.channel, opts);
}

const IMAGE_MIME_RE = /^image\//;

function hasImageAttachment(attachments) {
    return [...attachments.values()].some(a => IMAGE_MIME_RE.test(a.contentType ?? ''));
}

function buildDeleteButtonRow(authorId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`del_img:${authorId}`)
            .setLabel('削除')
            .setStyle(ButtonStyle.Danger),
    );
}

async function handleImageDeleteButton(interaction) {
    const authorId = interaction.customId.split(':')[1];

    if (interaction.user.id !== authorId) {
        return interaction.reply({ content: '削除できるのは投稿者本人のみです。', ephemeral: true });
    }

    await interaction.deferUpdate().catch(() => {});
    await interaction.deleteReply().catch(() => {});
}

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

    const excl     = getModExcludeList();
    const isExempt =
        EXEMPT_ROLES.some(id => message.member?.roles.cache.has(id)) ||
        excl.users.includes(message.author.id) ||
        excl.roles.some(roleId => message.member?.roles.cache.has(roleId));

    const strippedContent  = stripTupperPrefix(rawContent);
    const normalized       = normalizeForDetection(strippedContent);
    const { hit, matched } = checkNgWords(normalized);

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

module.exports = { handleModerator, handleImageDeleteButton };