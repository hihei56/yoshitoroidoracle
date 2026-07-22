// nekoclear.js — 指定ユーザーの直近発言を一括削除（BANはしない、管理者専用、実行前に件数確認あり）
const crypto = require('crypto');
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    PermissionsBitField, ChannelType,
} = require('discord.js');

const ADMIN_ROLE_ID = '1495971497016164492';
const MAX_AGE_MS = 13.5 * 24 * 60 * 60 * 1000; // Discordのbulk delete制限(14日)より少し手前で打ち切る
const FETCH_BATCH = 100;
const MAX_BATCHES_PER_CHANNEL = 30; // 1チャンネルあたり最大3000件まで走査
const PENDING_TTL_MS = 10 * 60 * 1000; // 確認待ちは10分で失効

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

// token -> { user, periodLabel, scopeLabel, perChannel: [{channel, messages}], scannedChannels, anyTruncated }
const pendingClears = new Map();

function hasAdminPermission(member) {
    if (!member) return false;
    if (member.id === member.guild.ownerId) return true;
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    return member.roles.cache.has(ADMIN_ROLE_ID);
}

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

async function deleteMessages(perChannel) {
    let deletedCount = 0;
    for (const { channel, messages } of perChannel) {
        for (let i = 0; i < messages.length; i += FETCH_BATCH) {
            const chunk = messages.slice(i, i + FETCH_BATCH);
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
    return deletedCount;
}

function buildNoteLines(anyTruncated) {
    const lines = ['※14日以上前のメッセージは削除できません。'];
    if (anyTruncated) lines.push('※一部のチャンネルはメッセージ数が多く、走査上限に達したため一部が対象外の可能性があります。');
    return lines;
}

function buildConfirmRow(token) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`nekoclear_confirm:${token}`).setLabel('削除を実行').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`nekoclear_cancel:${token}`).setLabel('キャンセル').setStyle(ButtonStyle.Secondary),
    );
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

        const perChannel = [];
        let scannedChannels = 0;
        let anyTruncated = false;
        let totalCount = 0;

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
            if (result.messages.length > 0) {
                perChannel.push({ channel, messages: result.messages });
                totalCount += result.messages.length;
            }
        }

        const periodLabel = PERIOD_LABELS[period] ?? PERIOD_LABELS['7d'];
        const scopeLabel  = targetChannel ? `<#${targetChannel.id}>` : 'サーバー全体';
        const noteLines   = buildNoteLines(anyTruncated);

        if (totalCount === 0) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🐱 nekoclear')
                        .setColor(0x99AAB5)
                        .setDescription(`<@${user.id}> (${user.tag}) の削除対象メッセージは見つかりませんでした。`)
                        .addFields(
                            { name: '走査チャンネル数', value: `${scannedChannels}件`, inline: true },
                            { name: '遡り範囲', value: periodLabel, inline: true },
                            { name: '対象', value: scopeLabel, inline: true },
                        )
                        .setTimestamp(),
                ],
            });
        }

        const token = crypto.randomUUID();
        pendingClears.set(token, {
            requestedBy: interaction.user.id,
            user, periodLabel, scopeLabel, perChannel, scannedChannels, anyTruncated,
        });
        setTimeout(() => pendingClears.delete(token), PENDING_TTL_MS).unref?.();

        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('⚠️ nekoclear 実行確認')
                    .setColor(0xFF6600)
                    .setDescription(`<@${user.id}> (${user.tag}) の発言を削除しますか？\n※BANは行いません。この操作は元に戻せません。`)
                    .addFields(
                        { name: '削除予定件数', value: `${totalCount}件`, inline: true },
                        { name: '走査チャンネル数', value: `${scannedChannels}件`, inline: true },
                        { name: '遡り範囲', value: periodLabel, inline: true },
                        { name: '対象', value: scopeLabel, inline: true },
                        { name: '注意事項', value: noteLines.join('\n'), inline: false },
                    )
                    .setFooter({ text: '10分以内に確認しない場合、この確認は失効します。' })
                    .setTimestamp(),
            ],
            components: [buildConfirmRow(token)],
        });
    } catch (e) {
        console.error('[Nekoclear] エラー:', e);
        if (interaction.deferred) {
            return interaction.editReply({ content: '❌ 処理中にエラーが発生しました。' }).catch(() => {});
        }
        return interaction.reply({ content: '❌ 処理中にエラーが発生しました。', ephemeral: true }).catch(() => {});
    }
}

async function handleNekoclearConfirm(interaction, token) {
    if (!hasAdminPermission(interaction.member)) {
        return interaction.reply({ content: '❌ このコマンドは管理者のみ実行できます。', ephemeral: true });
    }

    const data = pendingClears.get(token);
    if (!data) {
        return interaction.update({ content: '⌛ この確認は失効しました。もう一度 `/nekoclear` を実行してください。', embeds: [], components: [] });
    }
    pendingClears.delete(token);

    await interaction.deferUpdate();

    let deletedCount = 0;
    try {
        deletedCount = await deleteMessages(data.perChannel);
    } catch (e) {
        console.error('[Nekoclear] 削除処理エラー:', e);
        return interaction.editReply({ content: '❌ 削除処理中にエラーが発生しました。', embeds: [], components: [] }).catch(() => {});
    }

    const noteLines = buildNoteLines(data.anyTruncated);

    return interaction.editReply({
        embeds: [
            new EmbedBuilder()
                .setTitle('🐱 nekoclear 実行結果')
                .setColor(0x57F287)
                .setDescription(`<@${data.user.id}> (${data.user.tag}) の発言を削除しました。\n※BANは行っていません。`)
                .addFields(
                    { name: '削除件数', value: `${deletedCount}件`, inline: true },
                    { name: '走査チャンネル数', value: `${data.scannedChannels}件`, inline: true },
                    { name: '遡り範囲', value: data.periodLabel, inline: true },
                    { name: '対象', value: data.scopeLabel, inline: true },
                    { name: '注意事項', value: noteLines.join('\n'), inline: false },
                )
                .setFooter({ text: `実行者: ${interaction.user.tag}` })
                .setTimestamp(),
        ],
        components: [],
    });
}

async function handleNekoclearCancel(interaction, token) {
    pendingClears.delete(token);
    return interaction.update({ content: 'キャンセルしました。削除は行われていません。', embeds: [], components: [] });
}

module.exports = { handleNekoclear, handleNekoclearConfirm, handleNekoclearCancel };
