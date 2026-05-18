// imp.js — /imp コマンド
// lurkerになりすまして発言する（1495971497016164492ロール + 管理者が実行可能）
const { MessageFlags } = require('discord.js');
const { pickLurker } = require('./impersonate_manager');
const { getLastActivity } = require('./activity_tracker');

const ALLOWED_ROLE = '1495971497016164492';
const MAX_CHARS    = 150;

const FALLBACK_IMPERSONATOR_IDS = [
    '1096854565896323213',
    '1291500075327033458',
    '1474050297126064281',
    '1122087669598523423',
];

// ゼロ幅文字（moderator.jsと同じ定義）
const ZERO_WIDTH_MAP = { '0': '\u200B', '1': '\u200C' };
const ZERO_WIDTH_SEP = '\u200D';

function encodeId(id) {
    return [...BigInt(id).toString(2)].map(b => ZERO_WIDTH_MAP[b]).join('');
}

// 実行者ID + lurkerID を先頭に埋め込む
// → 💩リアクションで実行者本人が削除可能
// → リプライ時にlurkerにメンションが飛ぶ
function buildHiddenPrefix(authorId, lurkerId) {
    return encodeId(authorId) + ZERO_WIDTH_SEP + encodeId(lurkerId);
}

function sanitizeMentions(text) {
    if (!text) return text;
    return text
        .replace(/@everyone/g, '@\u200beveryone')
        .replace(/@here/g,     '@\u200bhere');
}

// キャッシュなし: 毎回pickLurkerを呼んでランダムに変える
async function getLurker(guild) {
    let lurker = await pickLurker(guild, { getLastActivity });

    if (!lurker) {
        const fallbackId = FALLBACK_IMPERSONATOR_IDS[
            Math.floor(Math.random() * FALLBACK_IMPERSONATOR_IDS.length)
        ];
        lurker = await guild.members.fetch(fallbackId).catch(() => null);
    }

    return lurker;
}

const webhookCache = new Map();

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
        // ── lurker取得（毎回ランダム） ──
        const lurker = await getLurker(guild);
        if (!lurker) {
            return interaction.editReply('なりすまし対象が見つかりませんでした。');
        }

        // ── Webhook取得 ──
        const targetChannel = channel.isThread() ? channel.parent : channel;
        let webhook = webhookCache.get(targetChannel.id);
        if (!webhook) {
            const webhooks = await targetChannel.fetchWebhooks().catch(() => null);
            webhook = webhooks?.find(wh => wh.owner?.id === client.user.id);
            if (!webhook) webhook = await targetChannel.createWebhook({ name: 'ImpProxy' });
            webhookCache.set(targetChannel.id, webhook);
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
                const authorName = repliedMsg.webhookId
                    ? repliedMsg.author.username
                    : `<@${repliedMsg.author.id}>`;
                const rawQuote  = (repliedMsg.content || '').replace(/\n/g, ' ');
                const quoteLine = rawQuote.length > QUOTE_MAX
                    ? rawQuote.slice(0, QUOTE_MAX) + '…'
                    : rawQuote;
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