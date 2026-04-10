// say.js
const { MessageFlags } = require('discord.js');
const { getSettings } = require('./config');
const axios = require('axios');

const TOKUMEI_USER_ID = '1419689848968581272';

function sanitizeMentions(text) {
    if (!text) return text;
    return text
        .replace(/@everyone/g, '@\u200beveryone')
        .replace(/@here/g,     '@\u200bhere');
}

async function decorateName(baseName) {
    try {
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.1-8b-instant',
            max_tokens: 30,
            messages: [
                {
                    role: 'system',
                    content: 'ユーザーのDiscord名を受け取り、弱者男性の代弁者などを意味する語彙で修飾。絵文字などを使ってよい。名前だけ返せ。元の名前を別表現に言い換え。余計な説明は不要。'
                },
                { role: 'user', content: baseName }
            ]
        }, {
            headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
            timeout: 5000,
        });
        return res.data.choices[0].message.content.trim().slice(0, 32);
    } catch {
        return `【代弁者】${baseName}`;
    }
}

const webhookCache = new Map();

async function handleSay(interaction) {
    const { member, channel, options, client, guild, user } = interaction;
    const settings = getSettings();

    const isDenied = !member.permissions.has('Administrator') && (
        settings.deniedUsers.includes(user.id) ||
        (settings.deniedRoles ?? []).some(r => member.roles.cache.has(r))
    );
    if (isDenied) {
        return interaction.reply({ content: '実行権限がありません。', flags: [MessageFlags.Ephemeral] });
    }

    const rawContent = options.getString('content') || '';
    if (rawContent.length > 500) {
        return interaction.reply({ content: '長すぎます（500文字以内）。', flags: [MessageFlags.Ephemeral] });
    }

    const content = sanitizeMentions(rawContent);

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
        const targetChannel = channel.isThread() ? channel.parent : channel;

        let webhook = webhookCache.get(targetChannel.id);
        if (!webhook) {
            const webhooks = await targetChannel.fetchWebhooks().catch(() => null);
            webhook = webhooks?.find(wh => wh.owner?.id === client.user.id);
            if (!webhook) {
                webhook = await targetChannel.createWebhook({ name: 'FastProxy' });
            }
            webhookCache.set(targetChannel.id, webhook);
        }

        const isTokumei = options.getBoolean('tokumei') === true;
        let finalName, finalIcon;

        if (isTokumei) {
            const tokumeiMember = await guild.members.fetch(TOKUMEI_USER_ID).catch(() => null);
            if (tokumeiMember) {
                finalName = await decorateName(tokumeiMember.displayName);
                finalIcon = tokumeiMember.user.displayAvatarURL({ dynamic: true });
            } else {
                const tokumeiUser = await client.users.fetch(TOKUMEI_USER_ID).catch(() => null);
                const baseName = tokumeiUser?.username ?? '弱者男性';
                finalName = await decorateName(baseName);
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
            ...(channel.isThread() && { threadId: channel.id }),
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