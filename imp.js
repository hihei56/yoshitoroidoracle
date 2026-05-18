// imp.js — /imp コマンド
// lurkerになりすまして発言する（特定ロール + 管理者が実行可能）
const { MessageFlags } = require('discord.js');
const { getLastActivity } = require('./activity_tracker');

// ★修正1: 独自のキャッシュをやめ、webhook_store を読み込む
const webhookStore = require('./webhook_store');

const ALLOWED_ROLE = '1495971497016164492';
const MAX_CHARS    = 150;

// lurkerがいない場合のフォールバック固定ID
const FALLBACK_IMPERSONATOR_IDS = [
    '1096854565896323213',
    '1291500075327033458',
    '1474050297126064281',
    '1122087669598523423',
];

// ROM専条件
const THREE_WEEKS_MS = 3 * 7 * 24 * 60 * 60 * 1000;
const EXCLUDE_ROLE_IDS = new Set([
    '1491824502169145484',
    '1477262864883515564',
    '1478715790575538359',
]);

// ゼロ幅文字
const ZERO_WIDTH_MAP     = { '0': '\u200B', '1': '\u200C' };
const REVERSE_ZERO_WIDTH = { '\u200B': '0', '\u200C': '1' };
const ZERO_WIDTH_SEP     = '\u200D';

function encodeId(id) {
    return [...BigInt(id).toString(2)].map(b => ZERO_WIDTH_MAP[b]).join('');
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

function buildHiddenPrefix(authorId, lurkerId) {
    return encodeId(authorId) + ZERO_WIDTH_SEP + encodeId(lurkerId);
}

function sanitizeMentions(text) {
    if (!text) return text;
    return text
        .replace(/@everyone/g, '@\u200beveryone')
        .replace(/@here/g,     '@\u200bhere');
}

// ★修正2: 前回選んだlurkerIDをギルド（サーバー）ごとに記録（マルチサーバー汚染対策）
const lastLurkerIdMap = new Map();

async function getLurker(guild) {
    const members = await guild.members.fetch().catch(() => null);
    if (!members) return null;

    const threshold = Date.now() - THREE_WEEKS_MS;

    const lurkers = [...members.filter(m => {
        if (m.user.bot) return false;
        if (m.permissions.has('Administrator')) return false;
        if ([...EXCLUDE_ROLE_IDS].some(id => m.roles.cache.has(id))) return false;
        const last = getLastActivity(m.id);
        if (last === null) return (m.joinedTimestamp ?? 0) < threshold;
        return last < threshold;
    }).values()];

    console.log(`[IMP getLurker] 候補数: ${lurkers.length}`);

    if (!lurkers.length) {
        const fallbackId = FALLBACK_IMPERSONATOR_IDS[
            Math.floor(Math.random() * FALLBACK_IMPERSONATOR_IDS.length)
        ];
        return guild.members.fetch(fallbackId).catch(() => null);
    }

    // サーバーごとの前回のIDを取得
    const lastId = lastLurkerIdMap.get(guild.id);
    const others = lurkers.filter(m => m.id !== lastId);
    const pool   = others.length > 0 ? others : lurkers;

    const picked = pool[Math.floor(Math.random() * pool.length)];
    // サーバーごとの履歴を更新
    lastLurkerIdMap.set(guild.id, picked.id);
    return picked;
}

async function handleImp(interaction) {
    const { member, channel, options, client, guild, user } = interaction;

    // ── 権限チェック ──
    const hasPermission =
        member.permissions.has('Administrator') ||
        member.roles.cache.has(ALLOWED_ROLE);

    if (!hasPermission) {
        return interaction.reply({
            content: '実行権限がありません。',
            flags: [MessageFlags.Ephemeral],
        });
    }

    // ── 文字数チェック ──
    const rawContent = options.getString('content') || '';
    if (rawContent.length > MAX_CHARS) {
        return interaction.reply({
            content: `長すぎます（${MAX_CHARS}文字以内）。`,
            flags: [MessageFlags.Ephemeral],
        });
    }

    const content = sanitizeMentions(rawContent);
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
        const lurker = await getLurker(guild);
        if (!lurker) {
            return interaction.editReply('なりすまし対象が見つかりませんでした。');
        }

        // ★修正3: webhook_store を使用して取得・保存を行う
        const targetChannel = channel.isThread() ? channel.parent : channel;
        let webhook = webhookStore.get(targetChannel.id);
        
        if (!webhook) {
            const webhooks = await targetChannel.fetchWebhooks().catch(() => null);
            webhook = webhooks?.find(wh => wh.owner?.id === client.user.id);
            if (!webhook) webhook = await targetChannel.createWebhook({ name: 'ImpProxy' });
            webhookStore.set(targetChannel.id, webhook);
        }

        // ── リプライ処理 ──
        const QUOTE_MAX = 17;
        const file      = options.getAttachment('file');
        const replyLink = options.getString('reply_link');
        let replyPrefix = '';
        if (replyLink) {
            const messageId  = replyLink.split('/').pop();
            const repliedMsg = await channel.messages.fetch(messageId).catch(() => null);
            if (repliedMsg) {
                let authorName;
                if (repliedMsg.webhookId) {
                    const { displayId } = extractUserIds(repliedMsg.content);
                    authorName = displayId ? `<@${displayId}>` : repliedMsg.author.username;
                } else {
                    authorName = `<@${repliedMsg.author.id}>`;
                }

                const cleanBody = [...(repliedMsg.content || '')]
                    .filter(c => !REVERSE_ZERO_WIDTH[c] && c !== ZERO_WIDTH_SEP)
                    .join('')
                    .replace(/\n/g, ' ')
                    .trim();
                const quoteLine = cleanBody.length > QUOTE_MAX
                    ? cleanBody.slice(0, QUOTE_MAX) + '…'
                    : cleanBody;
                replyPrefix = `**[Reply to](${replyLink}) : ${authorName}**\n`
                    + (quoteLine ? `> ${quoteLine}\n` : '');
            }
        }

        const hiddenPrefix = buildHiddenPrefix(user.id, lurker.id);

        await webhook.send({
            content:         hiddenPrefix + replyPrefix + content,
            username:        lurker.displayName || lurker.user.username,
            avatarURL:       lurker.user.displayAvatarURL({ dynamic: true }),
            files:           file ? [file.url] : [],
            allowedMentions: { parse: [], roles: [] },
            ...(channel.isThread() && { threadId: channel.id }),
        });

        console.log(
            `[IMP] ${new Date().toISOString()} | user=${user.id}` +
            ` | lurker=${lurker.id}(${lurker.user.tag})` +
            ` | ch=#${channel.name}(${channel.id}) | "${rawContent.slice(0, 80)}"`
        );

        await interaction.deleteReply().catch(() => {});

    } catch (e) {
        console.error('[Imp Error]:', e.message);
        if (interaction.deferred) {
            await interaction.editReply(`エラーが発生しました: ${e.message}`).catch(() => {});
        }
    }
}

module.exports = { handleImp };