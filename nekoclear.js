// nekoclear.js — 指定ユーザーの直近発言を一括削除（BANはしない、管理者専用）
const { EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');

const ADMIN_ROLE_ID = '1495971497016164492';
const MAX_AGE_MS = 13.5 * 24 * 60 * 60 * 1000; // Discordのbulk delete制限(14日)より少し手前で打ち切る
const FETCH_BATCH = 100;
const MAX_BATCHES_PER_CHANNEL = 30; // 1チャンネルあたり最大3000件まで走査

const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;
const PERIOD_MS = {
    '1h':  1 * HOUR,
    '6h':  6 * HOUR,
    '12h': 12 * HOUR,
    '1d':  1 * DAY,
    '3d':  3 * DAY,
    '7d':  7 * DAY,
    '14d': 14 * DAY,
};
const PERIOD_LABELS = {
    '1h': '1時間', '6h': '6時間', '12h': '12時間',
    '1d': '1日', '3d': '3日', '7d': '7日', '14d': '14日',
};

const SCAN_PERMS = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.ManageMessages,
    PermissionsBitField.Flags.ReadMessageHistory,
];

function canScanChannel(channel, me) {
    const perms = channel.permissionsFor(me);
    return Boolean(perms) && SCAN_PERMS.every(flag => perms.has(flag));
}

async function collectUserMessages(channel, userId, earliest) {
    const collected = [];
    let before;
    let truncated = false;

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

        if (batchCount === MAX_BATCHES_PER_CHANNEL - 1) truncated = true;
    }

    return { messages: collected, truncated };
}

function hasAdminPermission(member) {
    if (!member) return false;
    if (member.id === member.guild.ownerId) return true;
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    return member.roles.cache.has(ADMIN_ROLE_ID);
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
        const user = interaction.options.getUser('user');
        const period = interaction.options.getString('period') ?? '7d';
        const targetChannel = interaction.options.getChannel('channel');

        const earliest = Date.now() - Math.min(PERIOD_MS[period] ?? PERIOD_MS['7d'], MAX_AGE_MS);

        let channels;
        if (targetChannel) {
            const resolved = interaction.guild.channels.cache.get(targetChannel.id);
            if (!resolved || !resolved.isTextBased?.()) {
                return interaction.reply({ content: '❌ テキストチャンネルを指定してください。', ephemeral: true });
            }
            if (!canScanChannel(resolved, me)) {
                return interaction.reply({ content: `❌ Botに <#${resolved.id}> で「チャンネルを見る」「メッセージの管理」「メッセージ履歴を読む」権限が必要です。`, ephemeral: true });
            }
            channels = [resolved];
        } else {
            channels = [...interaction.guild.channels.cache.values()].filter(c =>
                (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) &&
                canScanChannel(c, me)
            );
            if (channels.length === 0) {
                return interaction.reply({ content: '❌ Botが「チャンネルを見る」「メッセージの管理」「メッセージ履歴を読む」権限を持つチャンネルがありません。', ephemeral: true });
            }
        }

        await interaction.deferReply({ ephemeral: true });

        let deletedCount = 0;
        let scannedChannels = 0;
        let anyTruncated = false;

        for (const channel of channels) {
            let result;
            try {
                result = await collectUserMessages(channel, user.id, earliest);
            } catch (e) {
                console.error(`[Nekoclear] #${channel.name} の走査エラー:`, e.message);
                continue;
            }
            scannedChannels += 1;
            if (result.truncated) anyTruncated = true;

            const toDelete = result.messages;
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

        const periodLabel = PERIOD_LABELS[period] ?? PERIOD_LABELS['7d'];
        const noteLines = ['※14日以上前のメッセージは削除できません。'];
        if (anyTruncated) noteLines.push('※一部のチャンネルはメッセージ数が多く、走査上限に達したため一部が対象外の可能性があります。');

        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('🐱 nekoclear 実行結果')
                    .setColor(0x57F287)
                    .setDescription(`<@${user.id}> (${user.tag}) の発言を削除しました。\n※BANは行っていません。`)
                    .addFields(
                        { name: '削除件数', value: `${deletedCount}件`, inline: true },
                        { name: '走査チャンネル数', value: `${scannedChannels}件`, inline: true },
                        { name: '遡り範囲', value: periodLabel, inline: true },
                        { name: '対象', value: targetChannel ? `<#${targetChannel.id}>` : 'サーバー全体', inline: true },
                        { name: '注意事項', value: noteLines.join('\n'), inline: false },
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
