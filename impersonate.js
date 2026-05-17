// impersonate.js — /impersonate コマンド（管理者のみ）
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { addImpersonate, removeImpersonate, getImpersonateList, isImpersonated } = require('./impersonate_manager');

async function handleImpersonate(interaction) {
    if (!interaction.member?.permissions.has('Administrator')) {
        return interaction.reply({ content: '管理者のみ実行できます。', flags: [MessageFlags.Ephemeral] });
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