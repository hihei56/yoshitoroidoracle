// medialink.js — /medialink コマンドハンドラ
const { addMediaLinkBan, removeMediaLinkBan, getMediaLinkBanList } = require('./medialink_manager');

async function handleMediaLink(interaction) {
    const action = interaction.options.getString('action');

    if (action === 'list') {
        const list = getMediaLinkBanList();
        if (list.length === 0) {
            return interaction.reply({ content: '📋 メディアリンクBAN中のユーザーはいません。', ephemeral: true });
        }
        const lines = list.map(id => `<@${id}> (${id})`).join('\n');
        return interaction.reply({ content: `📋 **メディアリンクBAN一覧**\n${lines}`, ephemeral: true });
    }

    const user = interaction.options.getUser('user');
    if (!user) {
        return interaction.reply({ content: '❌ ユーザーを指定してください。', ephemeral: true });
    }

    if (action === 'add') {
        addMediaLinkBan(user.id);
        return interaction.reply({ content: `🔗 <@${user.id}> のメディアリンク投稿を禁止しました。リンクは自動でストリップされます。`, ephemeral: true });
    }

    if (action === 'remove') {
        removeMediaLinkBan(user.id);
        return interaction.reply({ content: `✅ <@${user.id}> のメディアリンクBANを解除しました。`, ephemeral: true });
    }
}

module.exports = { handleMediaLink };
