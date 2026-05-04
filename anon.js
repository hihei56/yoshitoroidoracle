// anon.js — /anon コマンド
const { MessageFlags } = require('discord.js');
const { getSettings }  = require('./config');
const { getSession, createSession } = require('./say_sessions');
const axios = require('axios');

const TOKUMEI_USER_ID = '1419689848968581272';
const MAX_CHARS       = 150;

function sanitizeMentions(text) {
    if (!text) return text;
    return text
        .replace(/@everyone/g, '@\u200beveryone')
        .replace(/@here/g,     '@\u200bhere');
}

// 「匿名の〇〇」の〇〇部分をAIで生成（ユーザー名に依存しない完全ランダム）
async function generateAnonSuffix() {
    try {
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.1-8b-instant',
            max_tokens: 20,
            messages: [
                {
                    role: 'system',
                    content: 'ランダムに「匿名の」の後に続く短い表現（15文字以内）を生成してください。弱者男性・代弁者・孤独な男・敗北した人生・無敵の人などの概念を使ってください。毎回異なる表現にしてください。表現だけ返してください。余計な説明は不要。'
                },
                { role: 'user', content: '生成してください' }
            ]
        }, {
            headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
            timeout: 5000,
        });
        const suffix = res.data.choices[0].message.content.trim().slice(0, 15);
        return `匿名の${suffix}`;
    } catch {
        return '匿名の弱者男性';
    }
}

const webhookCache = new Map();

async function handleAnon(interaction) {
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
            return interaction.reply({ content: 'このチャンネルでは /anon は使用できません。', flags: [MessageFlags.Ephemeral] });
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
        // ── 24時間セッションで「匿名の〇〇」を固定 ──
        let session = getSession(user.id);
        if (!session) {
            const name = await generateAnonSuffix(); // ユーザー名に依存しないランダム生成
            session = createSession(user.id, name);
        }
        const finalName = session.name;

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
        const QUOTE_MAX   = 17;
        const file        = options.getAttachment('file');
        const replyLink   = options.getString('reply_link');
        let replyPrefix   = '';
        if (replyLink) {
            const messageId  = replyLink.split('/').pop();
            const repliedMsg = await channel.messages.fetch(messageId).catch(() => null);
            if (repliedMsg) {
                const authorName = repliedMsg.webhookId
                    ? repliedMsg.author.username
                    : `<@${repliedMsg.author.id}>`;
                const rawQuote   = (repliedMsg.content || '').replace(/\n/g, ' ');
                const quoteLine  = rawQuote.length > QUOTE_MAX
                    ? rawQuote.slice(0, QUOTE_MAX) + '…'
                    : rawQuote;
                replyPrefix = `**[Reply to](${replyLink}) : ${authorName}**\n`
                    + (quoteLine ? `> ${quoteLine}\n` : '');
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

        console.log(
            `[ANON] ${new Date().toISOString()} | user=${user.id} | ch=#${channel.name}(${channel.id}) | name="${finalName}" | "${rawContent.slice(0, 80)}"`
        );

        // ── 管理ログチャンネルに送信 ──
        const logChannelId = settings.anonLogChannelId;
        if (logChannelId) {
            try {
                const logCh = await client.channels.fetch(logChannelId);
                await logCh.send(
                    `\`[ANON]\` <t:${Math.floor(Date.now() / 1000)}:T>\n` +
                    `👤 ID: \`${user.id}\` / Nick: \`${member.displayName}\`\n` +
                    `🎭 匿名名: **${finalName}**\n` +
                    `📍 <#${channel.id}>\n` +
                    `💬 ${rawContent.slice(0, 400)}`
                );
            } catch (e) {
                console.warn('[ANON] ログ送信失敗:', e.message);
            }
        }

        await interaction.deleteReply().catch(() => {});

    } catch (e) {
        console.error('[Anon Error]:', e.message);
        if (interaction.deferred) {
            await interaction.editReply(`エラーが発生しました: ${e.message}`).catch(() => {});
        }
    }
}

module.exports = { handleAnon };
