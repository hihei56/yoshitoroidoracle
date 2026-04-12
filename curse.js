// curse.js — /curse コマンド（管理者のみ）
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { addCurse, removeCurse, getCursedList, isCursed } = require('./curse_manager');

async function handleCurse(interaction) {
    if (!interaction.member?.permissions.has('Administrator')) {
        return interaction.reply({ content: '管理者のみ実行できます。', flags: [MessageFlags.Ephemeral] });
    }

    const action = interaction.options.getString('action');
    const target = interaction.options.getUser('user');

    if (action === 'add') {
        addCurse(target.id);
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('🩸 呪い付与')
                    .setColor(0x2b0000)
                    .setDescription(`<@${target.id}> のメッセージに呪いをかけました。\n全ての発言が30〜40%文字化けします。`)
                    .setTimestamp()
            ],
            flags: [MessageFlags.Ephemeral],
        });
    }

    if (action === 'remove') {
        removeCurse(target.id);
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('✨ 呪い解除')
                    .setColor(0x57F287)
                    .setDescription(`<@${target.id}> の呪いを解きました。`)
                    .setTimestamp()
            ],
            flags: [MessageFlags.Ephemeral],
        });
    }

    if (action === 'list') {
        const list = getCursedList();
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('🩸 呪われたユーザー一覧')
                    .setColor(0x2b0000)
                    .setDescription(list.length ? list.map(id => `<@${id}>`).join('\n') : 'なし')
                    .setTimestamp()
            ],
            flags: [MessageFlags.Ephemeral],
        });
    }
}

module.exports = { handleCurse };
