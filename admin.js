const { updateModExcludeList } = require('./exclude_manager');
const { getSettings, saveSettings } = require('./config');

async function handleAdmin(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'mod_skip') {
        const action = interaction.options.getString('action');
        const targetUser = interaction.options.getUser('user');
        updateModExcludeList(targetUser.id, action);
        return interaction.reply({
            content: `[ADMIN] ${targetUser.tag} を例外リストに${action === 'add' ? '登録' : '解除'}しました。`,
            flags: [64]
        });
    }

    if (sub === 'say_deny') {
        const action = interaction.options.getString('action');
        const targetUser = interaction.options.getUser('user');
        const settings = getSettings();
        if (action === 'deny') {
            if (!settings.deniedUsers.includes(targetUser.id)) settings.deniedUsers.push(targetUser.id);
        } else {
            settings.deniedUsers = settings.deniedUsers.filter(id => id !== targetUser.id);
        }
        saveSettings(settings);
        return interaction.reply({
            content: `[ADMIN] 代行実行を${action === 'deny' ? '拒否' : '許可'}しました: ${targetUser.username}`,
            flags: [64]
        });
    }
}
module.exports = { handleAdmin };