const { MessageFlags } = require('discord.js');
const { getSettings } = require('./config');

// チャンネルごとのWebhookキャッシュ（ラグ防止）
const webhookCache = new Map();

async function handleSay(interaction) {
    const { member, channel, options, client, guild, user } = interaction;
    const settings = getSettings();

    // 1. 権限チェック
    if (!member.permissions.has('Administrator') && settings.deniedUsers.includes(user.id)) {
        return interaction.reply({ content: "実行権限がありません。", flags: [MessageFlags.Ephemeral] });
    }

    const content = options.getString('content') || "";
    if (content.length > 500) {
        return interaction.reply({ content: "長すぎます（500文字以内）。", flags: [MessageFlags.Ephemeral] });
    }

    // 先に保留応答を返してタイムアウトを防ぐ
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
        // 2. Webhookの取得（キャッシュ利用）
        let webhook = webhookCache.get(channel.id);
        if (!webhook) {
            const webhooks = await channel.fetchWebhooks().catch(() => null);
            webhook = webhooks?.find(wh => wh.owner.id === client.user.id);
            if (!webhook) {
                webhook = await channel.createWebhook({ name: 'FastProxy' });
            }
            webhookCache.set(channel.id, webhook);
        }

        // 3. なりすまし情報の決定（動的切り替え）
        const selectedUser = options.getUser('target_user');
        let finalName, finalIcon;

        if (selectedUser) {
            // オプションでユーザーが選ばれた場合：その人になりすます
            const targetMember = await guild.members.fetch(selectedUser.id).catch(() => null);
            finalName = targetMember ? targetMember.displayName : selectedUser.username;
            finalIcon = selectedUser.displayAvatarURL({ dynamic: true });
        } else {
            // 選ばれていない場合：実行者（あなた）の名前とアイコン
            finalName = member.displayName;
            finalIcon = user.displayAvatarURL({ dynamic: true });
        }

        // 4. 疑似リプライ処理（Webhookへの返信も考慮）
        const file = options.getAttachment('file');
        const replyLink = options.getString('reply_link');
        let replyPrefix = "";

        if (replyLink) {
            const messageId = replyLink.split('/').pop();
            const repliedMsg = await channel.messages.fetch(messageId).catch(() => null);
            
            if (repliedMsg) {
                // 返信先がWebhook（なりすまし投稿）ならその名前を、通常ユーザーならメンションを使用
                const authorName = repliedMsg.webhookId ? repliedMsg.author.username : `<@${repliedMsg.author.id}>`;
                replyPrefix = `**[Reply to](${replyLink}) : ${authorName}**\n`;
            }
        }

        // 5. 送信
        await webhook.send({
            content: replyPrefix + content,
            username: finalName,
            avatarURL: finalIcon,
            files: file ? [file.url] : []
        });

        // 成功通知を消す
        await interaction.deleteReply().catch(() => {});

    } catch (e) {
        console.error("[Say Error]:", e.message);
        if (interaction.deferred) {
            await interaction.editReply(`エラーが発生しました: ${e.message}`).catch(() => {});
        }
    }
}

module.exports = { handleSay };