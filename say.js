// say.js
const { MessageFlags } = require('discord.js');
const { getSettings } = require('./config');

const TOKUMEI_USER_ID = '1419689848968581272';

function sanitizeMentions(text) {
    if (!text) return text;
    return text
        .replace(/@everyone/g, '@\u200beveryone')
        .replace(/@here/g,     '@\u200bhere')
        .replace(/@&\d+/g,     match => match.replace('@', '@\u200b'));
}

const webhookCache = new Map();

async function handleSay(interaction) {
    const { member, channel, options, client, guild, user } = interaction;
    const settings = getSettings();

    if (!member.permissions.has('Administrator') && settings.deniedUsers.includes(user.id)) {
        return interaction.reply({ content: '実行権限がありません。', flags: [MessageFlags.Ephemeral] });
    }

    const rawContent = options.getString('content') || '';
    if (rawContent.length > 500) {
        return interaction.reply({ content: '長すぎます（500文字以内）。', flags: [MessageFlags.Ephemeral] });
    }

    const content = sanitizeMentions(rawContent);

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
        let webhook = webhookCache.get(channel.id);
        if (!webhook) {
            const webhooks = await channel.fetchWebhooks().catch(() => null);
            webhook = webhooks?.find(wh => wh.owner?.id === client.user.id);
            if (!webhook) {
                webhook = await channel.createWebhook({ name: 'FastProxy' });
            }
            webhookCache.set(channel.id, webhook);
        }

        const isTokumei = options.getBoolean('tokumei') === true;
        let finalName, finalIcon;

        if (isTokumei) {
            const tokumeiMember = await guild.members.fetch(TOKUMEI_USER_ID).catch(() => null);
            if (tokumeiMember) {
                finalName = tokumeiMember.displayName;
                finalIcon = tokumeiMember.user.displayAvatarURL({ dynamic: true });
            } else {
                const tokumeiUser = await client.users.fetch(TOKUMEI_USER_ID).catch(() => null);
                finalName = tokumeiUser?.username ?? '弱者男性';
                finalIcon = tokumeiUser?.displayAvatarURL({ dynamic: true }) ?? undefined;
            }
        } else {
            finalName = member.displayName;
            finalIcon = user.displayAvatarURL({ dynamic: true });
        }

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
            username:        finalName,
            avatarURL:       finalIcon,
            files:           file ? [file.url] : [],
            allowedMentions: { parse: [], roles: [] },
        });

        await interaction.deleteReply().catch(() => {});

    } catch (e) {
        console.error('[Say Error]:', e.message);
        if (interaction.deferred) {
            await interaction.editReply(`エラーが発生しました: ${e.message}`).catch(() => {});
        }
    }
}

module.exports = { handleSay };