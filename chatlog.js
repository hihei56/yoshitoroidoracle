// chatlog.js — 指定ユーザーの発言ログをテキストファイルで出力（管理者専用、ユーザーIDでも指定可）
const {
    EmbedBuilder, PermissionsBitField, ChannelType, AttachmentBuilder,
} = require('discord.js');

const ADMIN_ROLE_ID = '1495971497016164492';
const FETCH_BATCH = 100;
const SCAN_TIME_BUDGET_MS = 10 * 60 * 1000; // 走査全体でこの時間を超えたら打ち切る（応答期限15分に対し余裕を残す）
const MAX_MESSAGES = 20000; // 出力上限（暴走防止）
const USER_ID_RE = /^\d{17,20}$/;

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
    '30d': 30 * DAY,
    '90d': 90 * DAY,
    'all': Infinity,
};
const PERIOD_LABELS = {
    '1h': '1時間', '6h': '6時間', '12h': '12時間',
    '1d': '1日', '3d': '3日', '7d': '7日', '14d': '14日',
    '30d': '30日', '90d': '90日', 'all': '全期間',
};

const SCAN_PERMS = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.ReadMessageHistory,
];

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

// user オプション（サーバー内のメンバーのみ選択可）に加えて、
// 退出済み/BAN済みユーザーでも指定できるよう user_id（生ID）も受け付ける
async function resolveTargetUser(interaction) {
    const userOpt = interaction.options.getUser('user');
    if (userOpt) return { user: userOpt };

    const rawId = interaction.options.getString('user_id');
    if (!rawId) return { error: 'user または user_id のどちらかを指定してください。' };
    if (!USER_ID_RE.test(rawId.trim())) return { error: 'user_id はユーザーIDの数字のみで指定してください。' };

    try {
        const user = await interaction.client.users.fetch(rawId.trim());
        return { user };
    } catch {
        return { error: '指定されたuser_idのユーザーが見つかりませんでした。' };
    }
}

async function collectUserMessages(channel, userId, earliest, deadline) {
    const collected = [];
    let before;
    let truncated = false;

    while (true) {
        if (Date.now() >= deadline) { truncated = true; break; }

        const batch = await channel.messages.fetch({ limit: FETCH_BATCH, ...(before && { before }) });
        if (batch.size === 0) break;

        let hitAgeLimit = false;
        for (const msg of batch.values()) {
            if (msg.createdTimestamp < earliest) { hitAgeLimit = true; break; }
            if (msg.author.id === userId && msg.content) collected.push(msg);
        }
        if (hitAgeLimit) break;

        before = batch.last().id;
        if (batch.size < FETCH_BATCH) break;
    }

    return { messages: collected, truncated };
}

// 本文のみ・1行1発言のテキスト形式（マルコフ連鎖などの学習用途向け）
function buildLogText(perChannel) {
    const all = [];
    for (const { messages } of perChannel) all.push(...messages);
    all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    return all
        .map(m => m.content.replace(/\r?\n/g, ' ').trim())
        .filter(line => line.length > 0)
        .join('\n');
}

async function handleChatlog(interaction) {
    try {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        }
        if (!hasAdminPermission(interaction.member)) {
            return interaction.reply({ content: '❌ このコマンドは管理者のみ実行できます。', ephemeral: true });
        }

        const { user: target, error } = await resolveTargetUser(interaction);
        if (error) {
            return interaction.reply({ content: `❌ ${error}`, ephemeral: true });
        }

        const me = interaction.guild.members.me;
        const period = interaction.options.getString('period') ?? '7d';
        const targetChannel = interaction.options.getChannel('channel');
        const periodMs = PERIOD_MS[period] ?? PERIOD_MS['7d'];
        const earliest = Number.isFinite(periodMs) ? Date.now() - periodMs : 0;

        let channels;
        if (targetChannel) {
            const resolved = interaction.guild.channels.cache.get(targetChannel.id);
            if (!resolved || !resolved.isTextBased?.()) {
                return interaction.reply({ content: '❌ テキストチャンネルを指定してください。', ephemeral: true });
            }
            if (!canScanChannel(resolved, me)) {
                return interaction.reply({ content: `❌ Botに <#${resolved.id}> で「チャンネルを見る」「メッセージ履歴を読む」権限が必要です。`, ephemeral: true });
            }
            channels = [resolved];
        } else {
            channels = [...interaction.guild.channels.cache.values()].filter(c =>
                (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) &&
                canScanChannel(c, me)
            );
            if (channels.length === 0) {
                return interaction.reply({ content: '❌ Botが「チャンネルを見る」「メッセージ履歴を読む」権限を持つチャンネルがありません。', ephemeral: true });
            }
        }

        await interaction.deferReply({ ephemeral: true });

        const perChannel = [];
        let scannedChannels = 0;
        let anyTruncated = false;
        let totalCount = 0;
        const deadline = Date.now() + SCAN_TIME_BUDGET_MS;

        for (const channel of channels) {
            if (Date.now() >= deadline || totalCount >= MAX_MESSAGES) { anyTruncated = true; break; }

            let result;
            try {
                result = await collectUserMessages(channel, target.id, earliest, deadline);
            } catch (e) {
                console.error(`[Chatlog] #${channel.name} の走査エラー:`, e.message);
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

        if (totalCount === 0) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('📝 chatlog')
                        .setColor(0x99AAB5)
                        .setDescription(`<@${target.id}> (${target.tag}) の発言ログは見つかりませんでした。`)
                        .addFields(
                            { name: '走査チャンネル数', value: `${scannedChannels}件`, inline: true },
                            { name: '遡り範囲', value: periodLabel, inline: true },
                            { name: '対象', value: scopeLabel, inline: true },
                        )
                        .setTimestamp(),
                ],
            });
        }

        const text = buildLogText(perChannel);
        const attachment = new AttachmentBuilder(Buffer.from(text, 'utf-8'), { name: `chatlog_${target.id}_${period}.txt` });

        const noteLines = ['※本文のみ・1行1発言のテキスト形式です（マルコフ連鎖などの学習用途向け）。'];
        if (anyTruncated) noteLines.push('※メッセージ数が多く、走査の時間/件数制限に達したため一部が対象外の可能性があります。');

        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('📝 chatlog')
                    .setColor(0x5865F2)
                    .setDescription(`<@${target.id}> (${target.tag}) の発言ログを出力しました。`)
                    .addFields(
                        { name: '出力件数', value: `${totalCount}件`, inline: true },
                        { name: '走査チャンネル数', value: `${scannedChannels}件`, inline: true },
                        { name: '遡り範囲', value: periodLabel, inline: true },
                        { name: '対象', value: scopeLabel, inline: true },
                        { name: '注意事項', value: noteLines.join('\n'), inline: false },
                    )
                    .setTimestamp(),
            ],
            files: [attachment],
        });
    } catch (e) {
        console.error('[Chatlog] エラー:', e);
        if (interaction.deferred) {
            return interaction.editReply({ content: '❌ 処理中にエラーが発生しました。' }).catch(() => {});
        }
        return interaction.reply({ content: '❌ 処理中にエラーが発生しました。', ephemeral: true }).catch(() => {});
    }
}

module.exports = { handleChatlog };
