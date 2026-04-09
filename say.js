// say.js — 高速なりすまし固定版
const { MessageFlags } = require('discord.js');
const { getSettings } = require('./config');

// チャンネルごとのWebhookを一時保存してラグを防止
const webhookCache = new Map();

// ★なりすまし対象のユーザーIDを固定
const TARGET_USER_ID = '1096854565896323213';

async function handleSay(interaction) {
    const { member, channel, options, client, guild } = interaction;
    const settings = getSettings();

    // 1. 権限チェック
    if (!member.permissions.has('Administrator') && settings.deniedUsers.includes(interaction.user.id)) {
        return interaction.reply({ content: "実行権限がありません。", flags: [MessageFlags.Ephemeral] });
    }

    const content = options.getString('content') || "";
    if (content.length > 500) {
        return interaction.reply({ content: "長すぎます（500文字以内）。", flags: [MessageFlags.Ephemeral] });
    }

    // 2. 処理中のラグを感じさせないよう先に保留応答を返す
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
        // 3. Webhookの高速取得（毎回検索せずキャッシュから呼び出し）
        let webhook = webhookCache.get(channel.id);
        
        if (!webhook) {
            const webhooks = await channel.fetchWebhooks().catch(() => null);
            // 自分のボットが作ったWebhookを探す
            if (webhooks) {
                webhook = webhooks.find(wh => wh.owner.id === client.user.id);
            }
            
            // なければ新規作成
            if (!webhook) {
                webhook = await channel.createWebhook({ 
                    name: 'FastProxy',
                    reason: 'High-speed impersonation mode'
                });
            }
            // キャッシュに保存
            webhookCache.set(channel.id, webhook);
        }

        // 4. なりすまし対象の情報を取得
        const targetMember = await guild.members.fetch(TARGET_USER_ID).catch(() => null);
        const displayName = targetMember ? targetMember.displayName : "匿名ユーザー";
        const avatarURL = targetMember ? targetMember.user.displayAvatarURL({ dynamic: true }) : null;

        // 5. リプライリンク・添付ファイルの処理
        const file = options.getAttachment('file');
        const replyLink = options.getString('reply_link');
        let replyPrefix = "";

        if (replyLink) {
            const messageId = replyLink.split('/').pop();
            const repliedMsg = await channel.messages.fetch(messageId).catch(() => null);
            if (repliedMsg) {
                replyPrefix = `**[Reply to](${replyLink}) : <@${repliedMsg.author.id}>**\n`;
            }
        }

        // 6. Webhook送信（指定したターゲットになりすまし）
        await webhook.send({
            content: replyPrefix + content,
            username: displayName,
            avatarURL: avatarURL,
            files: file ? [file.url] : []
        });

        // 完了したらEphemeralリプライを削除
        await interaction.deleteReply().catch(() => {});

    } catch (e) { 
        console.error("[Say Error]:", e.message);
        if (interaction.deferred) {
            await interaction.editReply(`エラーが発生しました: ${e.message}`).catch(() => {});
        }
    }
}

module.exports = { handleSay };