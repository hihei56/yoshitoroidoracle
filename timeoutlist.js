const {
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType
} = require('discord.js');

// 権限チェック（index.js と同じ設定）
const ALLOWED_ROLES = ['1476944370694488134', '1478715790575538359'];

function hasPermission(member) {
    if (!member) return false;
    if (member.permissions.has('Administrator')) return true;
    return ALLOWED_ROLES.some(roleId => member.roles.cache.has(roleId));
}

// タイムアウト延長の選択肢
const EXTEND_OPTIONS = [
    { label: '10分延長',   value: '10m',  minutes: 10   },
    { label: '30分延長',   value: '30m',  minutes: 30   },
    { label: '1時間延長',  value: '1h',   minutes: 60   },
    { label: '6時間延長',  value: '6h',   minutes: 360  },
    { label: '12時間延長', value: '12h',  minutes: 720  },
    { label: '1日延長',    value: '1d',   minutes: 1440 },
    { label: '7日延長',    value: '7d',   minutes: 10080 },
    { label: '28日延長',   value: '28d',  minutes: 40320 },
];

// 残り時間を人間が読みやすい形式にフォーマット
function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const days    = Math.floor(totalSeconds / 86400);
    const hours   = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (days    > 0) parts.push(`${days}日`);
    if (hours   > 0) parts.push(`${hours}時間`);
    if (minutes > 0) parts.push(`${minutes}分`);
    if (seconds > 0 && days === 0) parts.push(`${seconds}秒`);
    return parts.length > 0 ? parts.join(' ') : '間もなく解除';
}

// メインコマンドハンドラ
async function handleTimeoutList(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;

    // メンバー一覧を取得してタイムアウト中のみ抽出
    let timedOutMembers = [];
    try {
        const members = await guild.members.fetch();
        const now = Date.now();
        timedOutMembers = members
            .filter(m => m.communicationDisabledUntilTimestamp && m.communicationDisabledUntilTimestamp > now)
            .map(m => ({
                id:        m.id,
                tag:       m.user.tag,
                displayName: m.displayName,
                avatar:    m.user.displayAvatarURL({ size: 32 }),
                until:     m.communicationDisabledUntilTimestamp,
                remaining: m.communicationDisabledUntilTimestamp - now,
            }))
            .sort((a, b) => a.remaining - b.remaining); // 残り時間が短い順
    } catch (e) {
        console.error('[TimeoutList] メンバー取得エラー:', e);
        return interaction.editReply({ content: '❌ メンバー情報の取得に失敗しました。' });
    }

    // タイムアウト中のユーザーがいない場合
    if (timedOutMembers.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('🔇 タイムアウト一覧')
            .setDescription('現在タイムアウト中のメンバーはいません。')
            .setColor(0x57F287)
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }

    // ---- 一覧Embed ----
    const listEmbed = buildListEmbed(timedOutMembers);

    // ---- セレクトメニュー（ユーザー選択） ----
    const selectOptions = timedOutMembers.slice(0, 25).map(m => ({
        label:       m.displayName.slice(0, 25),
        description: `残り ${formatDuration(m.remaining)}`,
        value:       m.id,
        emoji:       '🔇',
    }));

    const userSelect = new StringSelectMenuBuilder()
        .setCustomId('timeout_user_select')
        .setPlaceholder('タイムアウトを延長するユーザーを選択...')
        .addOptions(selectOptions);

    const refreshButton = new ButtonBuilder()
        .setCustomId('timeout_refresh')
        .setLabel('更新')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔄');

    const cancelButton = new ButtonBuilder()
        .setCustomId('timeout_cancel')
        .setLabel('閉じる')
        .setStyle(ButtonStyle.Danger);

    const row1 = new ActionRowBuilder().addComponents(userSelect);
    const row2 = new ActionRowBuilder().addComponents(refreshButton, cancelButton);

    const reply = await interaction.editReply({
        embeds:     [listEmbed],
        components: [row1, row2],
    });

    // ---- コレクター（60秒間操作を受付） ----
    const collector = reply.createMessageComponentCollector({
        time: 60_000,
    });

    // 選択中ユーザーの状態管理
    let selectedUser = null;

    collector.on('collect', async ci => {
        // 操作したのがコマンド発行者かチェック
        if (ci.user.id !== interaction.user.id) {
            return ci.reply({ content: '❌ このメニューはコマンドを実行した人のみ操作できます。', ephemeral: true });
        }

        // 権限チェック（念のため再検証）
        const ciMember = await interaction.guild.members.fetch(ci.user.id).catch(() => null);
        if (!hasPermission(ciMember)) {
            return ci.reply({ content: '❌ この操作を行う権限がありません。', ephemeral: true });
        }

        // 閉じるボタン
        if (ci.customId === 'timeout_cancel') {
            collector.stop('cancelled');
            await ci.update({
                embeds:     [listEmbed.setFooter({ text: '操作を終了しました' })],
                components: [],
            });
            return;
        }

        // 更新ボタン
        if (ci.customId === 'timeout_refresh') {
            await ci.deferUpdate();
            const refreshed = await refreshMembers(guild);
            timedOutMembers = refreshed;

            if (refreshed.length === 0) {
                collector.stop('empty');
                return ci.editReply({
                    embeds: [new EmbedBuilder()
                        .setTitle('🔇 タイムアウト一覧')
                        .setDescription('現在タイムアウト中のメンバーはいません。')
                        .setColor(0x57F287)
                        .setTimestamp()],
                    components: [],
                });
            }

            const newEmbed   = buildListEmbed(refreshed);
            const newOptions = refreshed.slice(0, 25).map(m => ({
                label:       m.displayName.slice(0, 25),
                description: `残り ${formatDuration(m.remaining)}`,
                value:       m.id,
                emoji:       '🔇',
            }));
            userSelect.setOptions(newOptions);
            selectedUser = null;
            return ci.editReply({
                embeds:     [newEmbed],
                components: [
                    new ActionRowBuilder().addComponents(userSelect),
                    row2,
                ],
            });
        }

        // ユーザー選択
        if (ci.customId === 'timeout_user_select') {
            await ci.deferUpdate();
            selectedUser = timedOutMembers.find(m => m.id === ci.values[0]);
            if (!selectedUser) return;

            const detailEmbed = buildDetailEmbed(selectedUser);
            const extendSelect = buildExtendSelect(selectedUser);

            const backButton = new ButtonBuilder()
                .setCustomId('timeout_back')
                .setLabel('← 一覧に戻る')
                .setStyle(ButtonStyle.Secondary);

            return ci.editReply({
                embeds:     [detailEmbed],
                components: [
                    new ActionRowBuilder().addComponents(extendSelect),
                    new ActionRowBuilder().addComponents(backButton, cancelButton),
                ],
            });
        }

        // 一覧に戻る
        if (ci.customId === 'timeout_back') {
            await ci.deferUpdate();
            selectedUser = null;
            return ci.editReply({
                embeds:     [buildListEmbed(timedOutMembers)],
                components: [row1, row2],
            });
        }

        // 延長時間選択
        if (ci.customId === 'timeout_extend_select') {
            await ci.deferUpdate();
            if (!selectedUser) return;

            const option = EXTEND_OPTIONS.find(o => o.value === ci.values[0]);
            if (!option) return;

            try {
                const member = await guild.members.fetch(selectedUser.id);
                const newUntil = new Date(selectedUser.until + option.minutes * 60 * 1000);

                // Discord上限28日チェック
                const maxDate = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);
                if (newUntil > maxDate) {
                    return ci.followUp({
                        content: `⚠️ Discordの制限により、タイムアウトは最大28日後（<t:${Math.floor(maxDate / 1000)}:f>）までしか設定できません。`,
                        ephemeral: true,
                    });
                }

                await member.disableCommunicationUntil(newUntil, `タイムアウト延長: ${interaction.user.tag} による操作`);

                // 延長後の状態を更新
                selectedUser = {
                    ...selectedUser,
                    until:     newUntil.getTime(),
                    remaining: newUntil.getTime() - Date.now(),
                };

                const successEmbed = new EmbedBuilder()
                    .setTitle('✅ タイムアウト延長完了')
                    .setColor(0xFEE75C)
                    .addFields(
                        { name: 'ユーザー',     value: `<@${selectedUser.id}>`,                         inline: true },
                        { name: '延長時間',     value: option.label,                                      inline: true },
                        { name: '解除予定',     value: `<t:${Math.floor(selectedUser.until / 1000)}:f>`, inline: false },
                        { name: '残り時間',     value: formatDuration(selectedUser.remaining),            inline: true },
                        { name: '操作者',       value: `<@${interaction.user.id}>`,                       inline: true },
                    )
                    .setTimestamp();

                const backButton2 = new ButtonBuilder()
                    .setCustomId('timeout_back')
                    .setLabel('← 一覧に戻る')
                    .setStyle(ButtonStyle.Secondary);

                return ci.editReply({
                    embeds:     [successEmbed],
                    components: [new ActionRowBuilder().addComponents(backButton2, cancelButton)],
                });

            } catch (e) {
                console.error('[TimeoutList] 延長エラー:', e);
                return ci.followUp({
                    content: '❌ タイムアウトの延長に失敗しました。権限を確認してください。',
                    ephemeral: true,
                });
            }
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'time') {
            try {
                await interaction.editReply({
                    components: [],
                    embeds: [buildListEmbed(timedOutMembers).setFooter({ text: 'タイムアウト（60秒経過）' })],
                });
            } catch (_) {}
        }
    });
}

// ---- ヘルパー関数 ----

async function refreshMembers(guild) {
    const members = await guild.members.fetch();
    const now = Date.now();
    return members
        .filter(m => m.communicationDisabledUntilTimestamp && m.communicationDisabledUntilTimestamp > now)
        .map(m => ({
            id:          m.id,
            tag:         m.user.tag,
            displayName: m.displayName,
            avatar:      m.user.displayAvatarURL({ size: 32 }),
            until:       m.communicationDisabledUntilTimestamp,
            remaining:   m.communicationDisabledUntilTimestamp - now,
        }))
        .sort((a, b) => a.remaining - b.remaining);
}

function buildListEmbed(members) {
    const lines = members.map((m, i) => {
        const unixTime = Math.floor(m.until / 1000);
        return `\`${String(i + 1).padStart(2, '0')}.\` <@${m.id}> — 残り **${formatDuration(m.remaining)}** (<t:${unixTime}:f> 解除)`;
    });

    return new EmbedBuilder()
        .setTitle('🔇 タイムアウト中のメンバー')
        .setDescription(lines.join('\n'))
        .setColor(0xED4245)
        .addFields({ name: '合計', value: `${members.length} 人`, inline: true })
        .setFooter({ text: '延長するユーザーをセレクトメニューから選択してください' })
        .setTimestamp();
}

function buildDetailEmbed(member) {
    const unixTime = Math.floor(member.until / 1000);
    return new EmbedBuilder()
        .setTitle(`🔇 ${member.displayName} のタイムアウト詳細`)
        .setColor(0xFEE75C)
        .setThumbnail(member.avatar)
        .addFields(
            { name: 'ユーザー',   value: `<@${member.id}>`,                    inline: true  },
            { name: 'タグ',       value: member.tag,                             inline: true  },
            { name: '\u200B',     value: '\u200B',                               inline: false },
            { name: '解除予定日時', value: `<t:${unixTime}:F>`,                 inline: false },
            { name: '残り時間',   value: `⏳ ${formatDuration(member.remaining)}`, inline: true },
        )
        .setFooter({ text: '延長する時間を下のメニューから選択してください' })
        .setTimestamp();
}

function buildExtendSelect(member) {
    // 28日上限を超えるオプションはdisabled
    const maxMs = 28 * 24 * 60 * 60 * 1000;
    const options = EXTEND_OPTIONS.map(o => {
        const newRemaining = member.remaining + o.minutes * 60 * 1000;
        const over = newRemaining > maxMs;
        return {
            label:       o.label + (over ? ' (上限超過)' : ''),
            description: over
                ? '28日の上限を超えるため設定不可'
                : `解除: ${new Date(member.until + o.minutes * 60 * 1000).toLocaleString('ja-JP')}`,
            value:   o.value,
            emoji:   over ? '⚠️' : '⏱️',
        };
    });

    return new StringSelectMenuBuilder()
        .setCustomId('timeout_extend_select')
        .setPlaceholder('延長する時間を選択...')
        .addOptions(options);
}

module.exports = { handleTimeoutList };
