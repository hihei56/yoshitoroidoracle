// timeout.js — 手動タイムアウト付与コマンド
const { EmbedBuilder, PermissionsBitField } = require('discord.js');

const MAX_TIMEOUT_MINUTES = 40320; // Discord APIの上限（28日）

async function handleTimeout(interaction) {
    try {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        }

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            return interaction.reply({ content: '❌ このコマンドを使用するには「メンバーをタイムアウト」権限が必要です。', ephemeral: true });
        }

        const me = interaction.guild.members.me;
        if (!me?.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.ModerateMembers)) {
            return interaction.reply({ content: '❌ Botに「メンバーをタイムアウト」権限がありません。', ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        const minutes = interaction.options.getInteger('minutes') ?? 10;
        const reason = interaction.options.getString('reason') ?? 'なし';

        if (user.id === interaction.user.id) {
            return interaction.reply({ content: '❌ 自分自身をタイムアウトすることはできません。', ephemeral: true });
        }
        if (user.bot) {
            return interaction.reply({ content: '❌ Botをタイムアウトすることはできません。', ephemeral: true });
        }

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) {
            return interaction.reply({ content: '❌ このサーバーにいないユーザーです。', ephemeral: true });
        }
        if (!member.moderatable) {
            return interaction.reply({ content: '❌ このユーザーはロールの順位関係上タイムアウトできません。', ephemeral: true });
        }

        await interaction.deferReply();
        try {
            await member.timeout(minutes * 60 * 1000, `${reason}（実行者: ${interaction.user.tag}）`);
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🔇 タイムアウトを付与しました')
                        .setColor(0x57F287)
                        .addFields(
                            { name: '対象', value: `<@${user.id}> (${user.tag})`, inline: true },
                            { name: '期間', value: `${minutes}分`, inline: true },
                            { name: '理由', value: reason, inline: false },
                        )
                        .setFooter({ text: `実行者: ${interaction.user.tag}` })
                        .setTimestamp(),
                ],
            });
        } catch (e) {
            console.error('[Timeout] エラー:', e.message);
            return interaction.editReply({ content: `❌ タイムアウトに失敗しました: \`${e.message}\`` });
        }
    } catch (e) {
        console.error('[Timeout] 予期しないエラー:', e);
        return interaction.reply({ content: '❌ 処理中にエラーが発生しました。', ephemeral: true }).catch(() => {});
    }
}

module.exports = { handleTimeout, MAX_TIMEOUT_MINUTES };
