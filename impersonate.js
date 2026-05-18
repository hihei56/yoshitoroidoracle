// impersonate.js — /impersonate コマンド（管理者 または 運用ロール）
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { addImpersonate, removeImpersonate, getImpersonateList } = require('./impersonate_manager');

// imp.js と同じ運用ロールIDを指定
const ALLOWED_ROLE = '1495971497016164492';

async function handleImpersonate(interaction) {
    // ★修正4: Administratorハードコードを撤廃し、運用ロールも許可
    const hasPermission =
        interaction.member?.permissions.has('Administrator') ||
        interaction.member?.roles.cache.has(ALLOWED_ROLE);

    if (!hasPermission) {
        return interaction.reply({ 
            content: '実行権限がありません（管理者または運用ロールが必要です）。', 
            flags: [MessageFlags.Ephemeral] 
        });
    }

    const action = interaction.options.getString('action');
    const target = interaction.options.getUser('user');

    if (action === 'add') {
        if (!target) return interaction.reply({ content: 'ユーザーを指定してください。', flags: [MessageFlags.Ephemeral] });
        addImpersonate(target.id);
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('🎭 なりすまし付与')
                    .setColor(0x5865F2)
                    .setDescription(
                        `<@${target.id}> のメッセージになりすまし呪いをかけました。\n` +
                        `発言のたびにROM専のアイコン・名前・メンションで再投稿されます。`
                    )
                    .setTimestamp()
            ],
            flags: [MessageFlags.Ephemeral],
        });
    }

    if (action === 'remove') {
        if (!target) return interaction.reply({ content: 'ユーザーを指定してください。', flags: [MessageFlags.Ephemeral] });
        removeImpersonate(target.id);
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('✨ なりすまし解除')
                    .setColor(0x57F287)
                    .setDescription(`<@${target.id}> のなりすまし呪いを解きました。`)
                    .setTimestamp()
            ],
            flags: [MessageFlags.Ephemeral],
        });
    }

    if (action === 'list') {
        const list = getImpersonateList();
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('🎭 なりすまし中のユーザー一覧')
                    .setColor(0x5865F2)
                    .setDescription(list.length ? list.map(id => `<@${id}>`).join('\n') : 'なし')
                    .setTimestamp()
            ],
            flags: [MessageFlags.Ephemeral],
        });
    }
}

module.exports = { handleImpersonate };