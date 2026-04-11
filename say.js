// say.js
const { MessageFlags } = require('discord.js');
const { getSettings }  = require('./config');

const TOKUMEI_USER_ID = '1419689848968581272';
const FIXED_NAME      = '匿名の弱者男性';
const MAX_CHARS       = 150;

function sanitizeMentions(text) {
    if (!text) return text;
    return text
        .replace(/@everyone/g, '@\u200beveryone')
        .replace(/@here/g,     '@\u200bhere');
}

const webhookCache = new Map();

async function handleSay(interaction) {
    const { member, channel, options, client, guild, user } = interaction;
    const settings = getSettings();

    // ── 権限チェック ──
    const isDenied = !member.permissions.has('Administrator') && (
        settings.deniedUsers.includes(user.id) ||
        (settings.deniedRoles ?? []).some(r => member.roles.cache.has(r))
    );
    if (isDenied) {
        return interaction.reply({ content: '実行権限がありません。', flags: [MessageFlags.Ephemeral] });
    }

    // ── チャンネル制限チェック ──
    const allowedChannels = settings.allowedSayChannels ?? [];
    if (allowedChannels.length > 0) {
        const checkId = channel.isThread() ? channel.parentId : channel.id;
        if (!allowedChannels.includes(checkId)) {
            return interaction.reply({ content: 'このチャンネルでは /say は使用できません。', flags: [MessageFlags.Ephemeral] });
        }
    }

    // ── 文字数チェック ──
    const rawContent = options.getString('content') || '';
    if (rawContent.length > MAX_CHARS) {
        return interaction.reply({ content: `長すぎます（${MAX_CHARS}文字以内）。`, flags: [MessageFlags.Ephemeral] });
    }

    const content = sanitizeMentions(rawContent);
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
        // ── アバター取得（TOKUMEI_USER_IDのアイコン固定）──
        let finalIcon;
        try {
            const tokumeiMember = await guild.members.fetch(TOKUMEI_USER_ID).catch(() => null);
            finalIcon = tokumeiMember
                ? tokumeiMember.user.displayAvatarURL({ dynamic: true })
                : (await client.users.fetch(TOKUMEI_USER_ID))?.displayAvatarURL({ dynamic: true });
        } catch {
            finalIcon = undefined;
        }

        // ── Webhook取得 ──
        const targetChannel = channel.isThread() ? channel.parent : channel;
        let webhook = webhookCache.get(targetChannel.id);
        if (!webhook) {
            const webhooks = await targetChannel.fetchWebhooks().catch(() => null);
            webhook = webhooks?.find(wh => wh.owner?.id === client.user.id);
            if (!webhook) webhook = await targetChannel.createWebhook({ name: 'FastProxy' });
            webhookCache.set(targetChannel.id, webhook);
        }

        // ── リプライ処理 ──
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
                replyPrefix = `**[Reply to](${replyLink}) : ${authorName}**\n`;
            }
        }

        await webhook.send({
            content:         replyPrefix + content,
            username:        FIXED_NAME,
            avatarURL:       finalIcon,
            files:           file ? [file.url] : [],
            allowedMentions: { parse: [], roles: [] },
            ...(channel.isThread() && { threadId: channel.id }),
        });

        console.log(
            `[SAY] ${new Date().toISOString()} | user=${user.id}` +
            ` | ch=#${channel.name}(${channel.id}) | "${rawContent.slice(0, 80)}"`
        );

        await interaction.deleteReply().catch(() => {});

    } catch (e) {
        console.error('[Say Error]:', e.message);
        if (interaction.deferred) {
            await interaction.editReply(`エラーが発生しました: ${e.message}`).catch(() => {});
        }
    }
}

module.exports = { handleSay };
