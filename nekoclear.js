// nekoclear.js — 指定ユーザーの直近発言をサーバー全体から一括削除（BANはしない、管理者専用）
const { EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');

const ADMIN_ROLE_ID = '1495971497016164492';
const MAX_AGE_MS = 13.5 * 24 * 60 * 60 * 1000; // Discordのbulk delete制限(14日)より少し手前で打ち切る
const FETCH_BATCH = 100;
const MAX_BATCHES_PER_CHANNEL = 20; // 1チャンネルあたり最大2000件まで走査

function hasAdminPermission(member) {
    if (!member) return false;
    if (member.id === member.guild.ownerId) return true;
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    return member.roles.cache.has(ADMIN_ROLE_ID);
}

async function collectUserMessages(channel, userId, earliest) {
    const collected = [];
    let before;

    for (let batchCount = 0; batchCount < MAX_BATCHES_PER_CHANNEL; batchCount++) {
        const batch = await channel.messages.fetch({ limit: FETCH_BATCH, ...(before && { before }) });
        if (batch.size === 0) break;

        let hitAgeLimit = false;
        for (const msg of batch.values()) {
            if (msg.createdTimestamp < earliest) { hitAgeLimit = true; break; }
            if (!msg.pinned && msg.author.id === userId) collected.push(msg);
        }
        if (hitAgeLimit) break;

        before = batch.last().id;
        if (batch.size < FETCH_BATCH) break;
    }

    return collected;
}

async function handleNekoclear(interaction) {
    try {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        }
        if (!hasAdminPermission(interaction.member)) {
            return interaction.reply({ content: '❌ このコマンドは管理者のみ実行できます。', ephemeral: true });
        }

        const me = interaction.guild.members.me;
        if (!me?.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: '❌ Botに「メッセージの管理」権限が必要です。', ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        const days = interaction.options.getInteger('days') ?? 7;
        const earliest = Date.now() - Math.min(days * 24 * 60 * 60 * 1000, MAX_AGE_MS);

        await interaction.deferReply({ ephemeral: true });

        const channels = [...interaction.guild.channels.cache.values()].filter(c =>
            (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) &&
            c.permissionsFor(me)?.has(PermissionsBitField.Flags.ManageMessages) &&
            c.permissionsFor(me)?.has(PermissionsBitField.Flags.ReadMessageHistory)
        );

        let deletedCount = 0;
        let scannedChannels = 0;

        for (const channel of channels) {
            let toDelete;
            try {
                toDelete = await collectUserMessages(channel, user.id, earliest);
            } catch (e) {
                console.error(`[Nekoclear] #${channel.name} の走査エラー:`, e.message);
                continue;
            }
            scannedChannels += 1;
            if (toDelete.length === 0) continue;

            for (let i = 0; i < toDelete.length; i += FETCH_BATCH) {
                const chunk = toDelete.slice(i, i + FETCH_BATCH);
                try {
                    if (chunk.length === 1) {
                        await chunk[0].delete();
                        deletedCount += 1;
                    } else {
                        const deleted = await channel.bulkDelete(chunk, true);
                        deletedCount += deleted.size;
                    }
                } catch (e) {
                    console.error(`[Nekoclear] #${channel.name} の削除エラー:`, e.message);
                }
            }
        }

        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('🐱 nekoclear 実行結果')
                    .setColor(0x57F287)
                    .setDescription(`<@${user.id}> (${user.tag}) の発言を削除しました。\n※BANは行っていません。`)
                    .addFields(
                        { name: '削除件数', value: `${deletedCount}件`, inline: true },
                        { name: '走査チャンネル数', value: `${scannedChannels}件`, inline: true },
                        { name: '遡り範囲', value: `${days}日\n※14日以上前のメッセージは削除できません`, inline: true },
                    )
                    .setFooter({ text: `実行者: ${interaction.user.tag}` })
                    .setTimestamp(),
            ],
        });
    } catch (e) {
        console.error('[Nekoclear] エラー:', e);
        if (interaction.deferred) {
            return interaction.editReply({ content: '❌ 処理中にエラーが発生しました。' }).catch(() => {});
        }
        return interaction.reply({ content: '❌ 処理中にエラーが発生しました。', ephemeral: true }).catch(() => {});
    }
}

module.exports = { handleNekoclear };
