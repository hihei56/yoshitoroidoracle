const { MessageFlags } = require('discord.js');
const { getSettings } = require('./config');

// メモリ上にキャッシュして、毎回サーバーに問い合わせるのを防ぐ（ラグ対策）
const webhookCache = new Map();

async function handleSay(interaction) {
    const { user, member, channel, options, client } = interaction;
    const settings = getSettings();

    // 1. 権限・拒否ユーザーチェック
    if (!member.permissions.has('Administrator') && settings.deniedUsers.includes(user.id)) {
        return interaction.reply({ content: "実行権限がありません。", flags: [MessageFlags.Ephemeral] });
    }

    // 文字数制限 (スパム対策)
    const content = options.getString('content') || "";
    if (content.length > 500) {
        return interaction.reply({ content: "長すぎます（500文字以内）。", flags: [MessageFlags.Ephemeral] });
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
        // 2. Webhookの取得（キャッシュ優先）
        let webhook = webhookCache.get(channel.id);
        
        if (!webhook) {
            const webhooks = await channel.fetchWebhooks().catch(() => null);
            if (webhooks) {
                webhook = webhooks.find(wh => wh.owner.id === client.user.id);
            }
            
            if (!webhook) {
                webhook = await channel.createWebhook({ 
                    name: 'FastProxy',
                    reason: 'Say command functionality'
                }).catch(() => null);
            }
            
            if (webhook) webhookCache.set(channel.id, webhook);
        }

        if (!webhook) throw new Error("Webhookの作成に失敗しました。権限を確認してください。");

        // 3. リプライリンクの処理
        const file = options.getAttachment('file');
        const replyLink = options.getString('reply_link');
        let replyPrefix = "";

        if (replyLink) {
            // URLからメッセージIDを抽出
            const parts = replyLink.split('/');
            const messageId = parts[parts.length - 1];
            
            const repliedMsg = await channel.messages.fetch(messageId).catch(() => null);
            if (repliedMsg) {
                // メンション付きリプライを再現
                replyPrefix = `**[Reply to](${replyLink}) : <@${repliedMsg.author.id}>**\n`;
            }
        }

        // 4. Webhook送信
        await webhook.send({
            content: replyPrefix + content,
            username: member.displayName,
            avatarURL: user.displayAvatarURL({ dynamic: true }),
            files: file ? [file.url] : []
        });

        // 成功したらEphemeralリプライを消す
        await interaction.deleteReply().catch(() => {});

    } catch (e) { 
        console.error("[Say Command Error]:", e.message);
        if (interaction.deferred) {
            await interaction.editReply(`エラーが発生しました: ${e.message}`).catch(() => {});
        }
    }
}

module.exports = { handleSay };
