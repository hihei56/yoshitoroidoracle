const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');

const HOME_GUILD_ID = '1476939502319698054';
const { getModExcludeList, updateModExcludeList, resetModExcludeList } = require('./exclude_manager');
const { getSettings, saveSettings, resetSayDeny, resetSayChannels } = require('./config');

const COLOR = {
    add:    0x57F287, // 緑
    remove: 0x99AAB5, // グレー
    deny:   0xED4245, // 赤
    allow:  0x57F287, // 緑
    info:   0x5865F2, // Discordブルー
};

/* =========================
   📊 ステータス embed & ボタン
========================= */
function buildStatusEmbed() {
    const excl     = getModExcludeList();
    const settings = getSettings();

    const fmtUsers    = ids => ids.length ? ids.map(id => `<@${id}>`).join(' ')  : 'なし';
    const fmtRoles    = ids => ids.length ? ids.map(id => `<@&${id}>`).join(' ') : 'なし';
    const fmtChannels = ids => ids.length ? ids.map(id => `<#${id}>`).join(' ')  : '全チャンネル（無制限）';

    const logCh    = settings.anonLogChannelId ? `<#${settings.anonLogChannelId}>` : '未設定';
    const lurkerCh = settings.lurkerChannelId  ? `<#${settings.lurkerChannelId}>`  : '未設定';

    return new EmbedBuilder()
        .setTitle('🛡️ 管理設定')
        .setColor(COLOR.info)
        .addFields(
            { name: '🔇 検閲除外 — ユーザー', value: fmtUsers(excl.users),                           inline: true },
            { name: '🔇 検閲除外 — ロール',   value: fmtRoles(excl.roles),                           inline: true },
            { name: '\u200b',                  value: '\u200b',                                        inline: false },
            { name: '🚫 Anon拒否 — ユーザー', value: fmtUsers(settings.deniedUsers),                 inline: true },
            { name: '🚫 Anon拒否 — ロール',   value: fmtRoles(settings.deniedRoles),                 inline: true },
            { name: '\u200b',                  value: '\u200b',                                        inline: false },
            { name: '📢 Anon許可チャンネル',  value: fmtChannels(settings.allowedSayChannels ?? []), inline: false },
            { name: '📋 Anonログチャンネル',  value: logCh,                                           inline: false },
            { name: '😴 目覚ましチャンネル',  value: lurkerCh,                                        inline: false },
        )
        .setTimestamp();
}

function buildStatusComponents() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('admin_reset:mod_skip')
            .setLabel('検閲除外をリセット')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('admin_reset:say_deny')
            .setLabel('Say拒否をリセット')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('admin_reset:say_channels')
            .setLabel('Sayチャンネルをリセット')
            .setStyle(ButtonStyle.Danger),
    );
}

/* =========================
   🔥 コマンドハンドラ
========================= */
async function handleAdmin(interaction) {
    if (!interaction.member?.permissions.has('Administrator')) {
        return interaction.reply({ content: '管理者のみ実行できます。', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    // ── 検閲除外 ──
    if (sub === 'mod_skip') {
        const action     = interaction.options.getString('action');
        const targetUser = interaction.options.getUser('user');
        const targetRole = interaction.options.getRole('role');

        if (!targetUser && !targetRole) {
            return interaction.reply({ content: 'ユーザーかロールを指定してください。', ephemeral: true });
        }

        const verb  = action === 'add' ? '追加' : '解除';
        const lines = [];
        if (targetUser) { updateModExcludeList(targetUser.id, action, 'user'); lines.push(`👤 <@${targetUser.id}>`); }
        if (targetRole) { updateModExcludeList(targetRole.id, action, 'role'); lines.push(`👥 <@&${targetRole.id}>`); }

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(`🔇 検閲除外 — ${verb}`)
                    .setColor(COLOR[action])
                    .setDescription(lines.join('\n'))
                    .setTimestamp()
            ],
            ephemeral: true,
        });
    }

    // ── Say権限 ──
    if (sub === 'say_deny') {
        const action     = interaction.options.getString('action');
        const targetUser = interaction.options.getUser('user');
        const targetRole = interaction.options.getRole('role');

        if (!targetUser && !targetRole) {
            return interaction.reply({ content: 'ユーザーかロールを指定してください。', ephemeral: true });
        }

        const verb     = action === 'deny' ? '拒否' : '許可';
        const settings = getSettings();
        const lines    = [];

        if (targetUser) {
            if (action === 'deny') {
                if (!settings.deniedUsers.includes(targetUser.id)) settings.deniedUsers.push(targetUser.id);
            } else {
                settings.deniedUsers = settings.deniedUsers.filter(id => id !== targetUser.id);
            }
            lines.push(`👤 <@${targetUser.id}>`);
        }
        if (targetRole) {
            if (action === 'deny') {
                if (!settings.deniedRoles.includes(targetRole.id)) settings.deniedRoles.push(targetRole.id);
            } else {
                settings.deniedRoles = settings.deniedRoles.filter(id => id !== targetRole.id);
            }
            lines.push(`👥 <@&${targetRole.id}>`);
        }
        saveSettings(settings);

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(`🚫 Say権限 — ${verb}`)
                    .setColor(COLOR[action])
                    .setDescription(lines.join('\n'))
                    .setTimestamp()
            ],
            ephemeral: true,
        });
    }

    // ── Say許可チャンネル ──
    if (sub === 'say_channel') {
        const action  = interaction.options.getString('action');
        const ch      = interaction.options.getChannel('channel');
        const settings = getSettings();

        if (action === 'add') {
            if (!settings.allowedSayChannels.includes(ch.id)) settings.allowedSayChannels.push(ch.id);
        } else {
            settings.allowedSayChannels = settings.allowedSayChannels.filter(id => id !== ch.id);
        }
        saveSettings(settings);

        const verb = action === 'add' ? '追加' : '解除';
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(`📢 Say許可チャンネル — ${verb}`)
                    .setColor(COLOR[action])
                    .setDescription(`<#${ch.id}>`)
                    .setTimestamp()
            ],
            ephemeral: true,
        });
    }

    // ── 目覚ましチャンネル ──
    if (sub === 'lurker_channel') {
        const ch       = interaction.options.getChannel('channel');
        const settings = getSettings();
        settings.lurkerChannelId = ch?.id ?? null;
        saveSettings(settings);
        const verb = ch ? `<#${ch.id}> に設定` : '解除';
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('😴 ROM専目覚ましチャンネル')
                    .setColor(ch ? COLOR.add : COLOR.remove)
                    .setDescription(verb)
                    .setTimestamp()
            ],
            ephemeral: true,
        });
    }

    // ── Anonログチャンネル ──
    if (sub === 'log_channel') {
        const ch       = interaction.options.getChannel('channel');
        const settings = getSettings();
        if (ch) {
            settings.anonLogChannelId = ch.id;
            saveSettings(settings);
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('📋 Anonログチャンネル — 設定')
                        .setColor(COLOR.add)
                        .setDescription(`<#${ch.id}>`)
                        .setTimestamp()
                ],
                ephemeral: true,
            });
        } else {
            settings.anonLogChannelId = null;
            saveSettings(settings);
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('📋 Anonログチャンネル — 解除')
                        .setColor(COLOR.remove)
                        .setDescription('ログチャンネルを解除しました。')
                        .setTimestamp()
                ],
                ephemeral: true,
            });
        }
    }

    // ── 現在の設定を表示 ──
    if (sub === 'status') {
        return interaction.reply({
            embeds:     [buildStatusEmbed()],
            components: [buildStatusComponents()],
            ephemeral:  true,
        });
    }

    // ── 加入サーバー一覧 ──
    if (sub === 'servers') {
        return handleServers(interaction);
    }
}

/* =========================
   🌐 加入サーバー一覧 & 退出
========================= */
async function handleServers(interaction) {
    const guilds = interaction.client.guilds.cache;

    const lines = [...guilds.values()].map((g, idx) =>
        `${idx + 1}. **${g.name}** \`${g.id}\` — ${g.memberCount}人${g.id === HOME_GUILD_ID ? ' 🏠' : ''}`
    );

    const embed = new EmbedBuilder()
        .setTitle(`🌐 加入サーバー一覧 (${guilds.size}件)`)
        .setColor(COLOR.info)
        .setDescription(lines.join('\n'))
        .setTimestamp();

    const leavable = [...guilds.values()].filter(g => g.id !== HOME_GUILD_ID);

    if (leavable.length === 0) {
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const select = new StringSelectMenuBuilder()
        .setCustomId('admin_servers:leave_select')
        .setPlaceholder('退出するサーバーを選択...')
        .addOptions(
            leavable.map(g =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(g.name.slice(0, 100))
                    .setValue(g.id)
                    .setDescription(`ID: ${g.id} — ${g.memberCount}人`.slice(0, 100))
            )
        );

    return interaction.reply({
        embeds:     [embed],
        components: [new ActionRowBuilder().addComponents(select)],
        ephemeral:  true,
    });
}

async function handleServersLeaveSelect(interaction) {
    if (!interaction.member?.permissions.has('Administrator')) {
        return interaction.reply({ content: '管理者のみ実行できます。', ephemeral: true });
    }

    const guildId = interaction.values[0];
    const guild   = interaction.client.guilds.cache.get(guildId);

    if (!guild) {
        return interaction.update({ content: 'サーバーが見つかりません。', embeds: [], components: [] });
    }

    const embed = new EmbedBuilder()
        .setTitle('⚠️ サーバー退出の確認')
        .setColor(0xFF6600)
        .setDescription(`**${guild.name}** から退出しますか？`)
        .addFields(
            { name: 'サーバーID', value: guild.id,                   inline: true },
            { name: 'メンバー数', value: `${guild.memberCount}人`,    inline: true },
        )
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`admin_servers:leave_confirm:${guildId}`)
            .setLabel('退出する')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('admin_servers:leave_cancel')
            .setLabel('キャンセル')
            .setStyle(ButtonStyle.Secondary),
    );

    return interaction.update({ embeds: [embed], components: [row] });
}

async function handleServersLeaveConfirm(interaction, guildId) {
    if (!interaction.member?.permissions.has('Administrator')) {
        return interaction.reply({ content: '管理者のみ実行できます。', ephemeral: true });
    }

    const guild     = interaction.client.guilds.cache.get(guildId);
    const guildName = guild?.name ?? guildId;

    try {
        await guild?.leave();
        return interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle('✅ サーバーから退出しました')
                    .setColor(COLOR.remove)
                    .setDescription(`**${guildName}** から退出しました。`)
                    .setTimestamp(),
            ],
            components: [],
        });
    } catch (e) {
        return interaction.update({ content: `退出に失敗しました: \`${e.message}\``, embeds: [], components: [] });
    }
}

async function handleServersLeaveCancel(interaction) {
    return interaction.update({ content: 'キャンセルしました。', embeds: [], components: [] });
}

/* =========================
   🔘 リセットボタンハンドラ
   index.js の InteractionCreate から呼ばれる
========================= */
async function handleAdminButton(interaction) {
    if (!interaction.member?.permissions.has('Administrator')) {
        return interaction.reply({ content: '管理者のみ実行できます。', ephemeral: true });
    }

    const target = interaction.customId.split(':')[1];
    if (target === 'mod_skip')    resetModExcludeList();
    if (target === 'say_deny')    resetSayDeny();
    if (target === 'say_channels') resetSayChannels();

    // embed をリセット後の状態に更新
    await interaction.update({
        embeds:     [buildStatusEmbed()],
        components: [buildStatusComponents()],
    });
}

module.exports = { handleAdmin, handleAdminButton, handleServersLeaveSelect, handleServersLeaveConfirm, handleServersLeaveCancel };
