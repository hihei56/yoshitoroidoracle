// chatlog.js — 指定ユーザーの発言ログをファイルにエクスポートする（管理者専用）
const { EmbedBuilder, PermissionsBitField, ChannelType, AttachmentBuilder } = require('discord.js');

const ADMIN_ROLE_ID = '1495971497016164492';
const FETCH_BATCH = 100;
const SCAN_TIME_BUDGET_MS = 10 * 60 * 1000; // 走査全体でこの時間を超えたら打ち切る（応答期限15分に対し余裕を残す）
const MAX_EXPORT_MESSAGES = 10000; // ファイルサイズ・処理時間の上限
const MAX_LINES_PER_FILE = 2000; // 1ファイルあたりの上限（テキスト:行数 / JSON:メッセージ数）。超える場合は分割出力する
const MAX_FILES = 10; // Discordの添付ファイル数上限

const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;
const PERIOD_MS = {
    '1d':  1 * DAY,
    '3d':  3 * DAY,
    '7d':  7 * DAY,
    '14d': 14 * DAY,
    '30d': 30 * DAY,
    '90d': 90 * DAY,
};
const PERIOD_LABELS = {
    '1d': '1日', '3d': '3日', '7d': '7日', '14d': '14日', '30d': '30日', '90d': '90日',
    all: '全期間',
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

function formatJst(timestamp) {
    const jst = new Date(timestamp + 9 * 60 * 60 * 1000);
    return jst.toISOString().replace('T', ' ').slice(0, 19);
}

async function collectUserMessages(channel, userId, earliest, deadline, remaining) {
    const collected = [];
    let before;
    let truncated = false;

    while (collected.length < remaining) {
        if (Date.now() >= deadline) { truncated = true; break; }

        const batch = await channel.messages.fetch({ limit: FETCH_BATCH, ...(before && { before }) });
        if (batch.size === 0) break;

        let hitAgeLimit = false;
        for (const msg of batch.values()) {
            if (earliest && msg.createdTimestamp < earliest) { hitAgeLimit = true; break; }
            if (msg.author.id === userId) {
                collected.push(msg);
                if (collected.length >= remaining) { truncated = true; break; }
            }
        }
        if (hitAgeLimit) break;

        before = batch.last().id;
        if (batch.size < FETCH_BATCH) break;
    }

    return { messages: collected, truncated };
}

// マルコフ連鎖の学習コーパス向け: メタデータなしで発言本文のみを1行1発言で並べる
// （本文中の改行はスペースに畳んで1メッセージ=1行を保証し、本文が空の発言は除外する）
function buildTextLines(entries) {
    return entries
        .map(e => (e.content || '').replace(/\s*\n\s*/g, ' ').trim())
        .filter(line => line.length > 0);
}

function buildJsonChunk(user, chunk, part, totalParts, totalCount) {
    return JSON.stringify({
        user: { id: user.id, tag: user.tag },
        exportedAt: new Date().toISOString(),
        part, totalParts,
        count: chunk.length,
        totalCount,
        messages: chunk,
    }, null, 2);
}

function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
}

// メッセージ数が多い場合、Discordの添付ファイル数上限(10)に収まるよう
// チャンクサイズを底上げして分割数を抑える
function chunkForExport(arr) {
    const size = Math.max(MAX_LINES_PER_FILE, Math.ceil(arr.length / MAX_FILES));
    return chunkArray(arr, size);
}

function buildExportFiles({ user, entries, isJson, safeName, timestamp }) {
    const ext = isJson ? 'json' : 'txt';
    const items = isJson ? entries : buildTextLines(entries);
    const chunks = chunkForExport(items);
    const totalParts = chunks.length;

    return chunks.map((chunk, i) => {
        const content = isJson
            ? buildJsonChunk(user, chunk, i + 1, totalParts, entries.length)
            : chunk.join('\n');
        const suffix = totalParts > 1 ? `_part${i + 1}of${totalParts}` : '';
        return new AttachmentBuilder(Buffer.from(content, 'utf8'), { name: `chatlog_${safeName}_${timestamp}${suffix}.${ext}` });
    });
}

async function handleChatlog(interaction) {
    try {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        }
        if (!hasAdminPermission(interaction.member)) {
            return interaction.reply({ content: '❌ このコマンドは管理者のみ実行できます。', ephemeral: true });
        }

        const me = interaction.guild.members.me;
        const user = interaction.options.getUser('user');
        const period = interaction.options.getString('period') ?? '30d';
        const format = interaction.options.getString('format') ?? 'txt';
        const targetChannel = interaction.options.getChannel('channel');

        const earliest = period === 'all' ? null : Date.now() - (PERIOD_MS[period] ?? PERIOD_MS['30d']);

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

        const entries = [];
        let scannedChannels = 0;
        let anyTruncated = false;
        const deadline = Date.now() + SCAN_TIME_BUDGET_MS;

        for (const channel of channels) {
            if (Date.now() >= deadline || entries.length >= MAX_EXPORT_MESSAGES) { anyTruncated = true; break; }

            let result;
            try {
                result = await collectUserMessages(channel, user.id, earliest, deadline, MAX_EXPORT_MESSAGES - entries.length);
            } catch (e) {
                console.error(`[Chatlog] #${channel.name} の走査エラー:`, e.message);
                continue;
            }
            scannedChannels += 1;
            if (result.truncated) anyTruncated = true;
            for (const msg of result.messages) {
                entries.push({
                    channelId: channel.id,
                    channelName: channel.name,
                    messageId: msg.id,
                    timestamp: msg.createdTimestamp,
                    content: msg.content,
                    attachments: [...msg.attachments.values()].map(a => a.url),
                    url: msg.url,
                });
            }
        }

        entries.sort((a, b) => a.timestamp - b.timestamp);

        const periodLabel = PERIOD_LABELS[period] ?? PERIOD_LABELS['30d'];
        const scopeLabel  = targetChannel ? `<#${targetChannel.id}>` : 'サーバー全体';

        if (entries.length === 0) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('📤 チャットログエクスポート')
                        .setColor(0x99AAB5)
                        .setDescription(`<@${user.id}> (${user.tag}) の発言は見つかりませんでした。`)
                        .addFields(
                            { name: '走査チャンネル数', value: `${scannedChannels}件`, inline: true },
                            { name: '遡り範囲', value: periodLabel, inline: true },
                            { name: '対象', value: scopeLabel, inline: true },
                        )
                        .setTimestamp(),
                ],
            });
        }

        const isJson = format === 'json';
        const safeName = user.username.replace(/[^\w.-]/g, '_');
        const files = buildExportFiles({ user, entries, isJson, safeName, timestamp: Date.now() });

        if (files.length === 0) {
            return interaction.editReply({ content: 'ℹ️ 本文のある発言が見つからなかったため、テキストとして出力できませんでした（画像・添付のみの発言など）。JSON形式で試してみてください。' });
        }

        const noteLines = ['※Botが閲覧権限を持つチャンネルのみが対象です。'];
        if (anyTruncated) noteLines.push(`※メッセージ数が多いため、走査の時間/件数制限（最大${MAX_EXPORT_MESSAGES}件）に達し一部が対象外の可能性があります。`);
        if (files.length > 1) noteLines.push(`※メッセージ数が多いため、ファイルを${files.length}個に分割しました。`);

        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('📤 チャットログエクスポート')
                    .setColor(0x57F287)
                    .setDescription(`<@${user.id}> (${user.tag}) の発言をエクスポートしました。`)
                    .addFields(
                        { name: '件数', value: `${entries.length}件`, inline: true },
                        { name: '走査チャンネル数', value: `${scannedChannels}件`, inline: true },
                        { name: '遡り範囲', value: periodLabel, inline: true },
                        { name: '対象', value: scopeLabel, inline: true },
                        { name: '注意事項', value: noteLines.join('\n'), inline: false },
                    )
                    .setFooter({ text: `実行者: ${interaction.user.tag}` })
                    .setTimestamp(),
            ],
            files,
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
