// medialink.js — /medialink コマンドハンドラ
const { addMediaLinkBan, removeMediaLinkBan, getMediaLinkBanList } = require('./medialink_manager');

async function handleMediaLink(interaction) {
    const action    = interaction.options.getString('action');
    const channel   = interaction.options.getChannel('channel') ?? null;
    const channelId = channel?.id ?? null;

    if (action === 'list') {
        const list = getMediaLinkBanList();
        if (list.length === 0) {
            return interaction.reply({ content: '📋 メディアリンクBAN中のユーザーはいません。', ephemeral: true });
        }
        const lines = list.map(({ userId, channels }) => {
            const scope = channels === null
                ? '全チャンネル'
                : channels.map(id => `<#${id}>`).join(', ');
            return `<@${userId}> → ${scope}`;
        }).join('\n');
        return interaction.reply({ content: `📋 **メディアリンクBAN一覧**\n${lines}`, ephemeral: true });
    }

    const user = interaction.options.getUser('user');
    if (!user) {
        return interaction.reply({ content: '❌ ユーザーを指定してください。', ephemeral: true });
    }

    if (action === 'add') {
        addMediaLinkBan(user.id, channelId);
        const scope = channel ? `${channel} チャンネルのみ` : '全チャンネル';
        return interaction.reply({
            content: `🔗 <@${user.id}> のメディアリンク投稿を禁止しました（${scope}）。リンクは自動でストリップされます。`,
            ephemeral: true,
        });
    }

    if (action === 'remove') {
        removeMediaLinkBan(user.id, channelId);
        const scope = channel ? `${channel} チャンネルの` : '全チャンネルの';
        return interaction.reply({
            content: `✅ <@${user.id}> の${scope}メディアリンクBANを解除しました。`,
            ephemeral: true,
        });
    }
}

module.exports = { handleMediaLink };
