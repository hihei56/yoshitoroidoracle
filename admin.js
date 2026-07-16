const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');

const HOME_GUILD_ID  = '1476939502319698054';
const ADMIN_ROLE_ID  = '1495971497016164492';

function hasAdminPermission(member) {
    if (!member) return false;
    if (member.id === member.guild.ownerId) return true;
    if (member.permissions.has('Administrator')) return true;
    return member.roles.cache.has(ADMIN_ROLE_ID);
}
const { getModExcludeList, updateModExcludeList, resetModExcludeList } = require('./exclude_manager');
const { getSettings, saveSettings, resetSayDeny, resetSayChannels } = require('./config');
const { resolveDataPath, readJson, writeJson } = require('./dataPath');

const PRESENCE_FILE = resolveDataPath('presence.json');

function loadSavedPresence() {
    return readJson(PRESENCE_FILE, null);
}

function savePresence(data) {
    writeJson(PRESENCE_FILE, data);
}

async function restorePresence(client) {
    const saved = loadSavedPresence();
    if (!saved) return;
    if (saved.status === 'mobile') {
        client.options.ws = {
            ...(client.options.ws ?? {}),
            properties: { browser: 'Discord Android' },
        };
        await client.destroy();
        await client.login(process.env.DISCORD_TOKEN);
    } else {
        client.user.setPresence({ status: saved.status });
    }
    console.info(`[PRESENCE] 保存済みステータスを復元: ${saved.status}`);
}
const { handleKickInactive } = require('./kick_inactive');
const { getNgWords, addNgWord, removeNgWord } = require('./ng_word_manager');
const { resetShiritoriGame } = require('./shiritori');
const { handleBumpRemindCommand } = require('./bump');
const { forcePost: forceChatterPost, getProviderStatus: getChatterProviderStatus } = require('./chatter');
const { resetPersona: resetChatterPersona } = require('./chatter_persona');
const { forceRecruitPost, getVCRecruitSettings } = require('./vc_recruit');
const { getStrikeCount, resetStrikes } = require('./spam_enforcer');
const { resetRtaRace } = require('./rta');

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
    if (!settings.cryAllowedUsers) settings.cryAllowedUsers = [];

    const fmtUsers    = ids => ids.length ? ids.map(id => `<@${id}>`).join(' ')  : 'なし';
    const fmtRoles    = ids => ids.length ? ids.map(id => `<@&${id}>`).join(' ') : 'なし';
    const fmtChannels = ids => ids.length ? ids.map(id => `<#${id}>`).join(' ')  : '全チャンネル（無制限）';

    const logCh     = settings.anonLogChannelId ? `<#${settings.anonLogChannelId}>` : '未設定';
    const lurkerCh  = settings.lurkerChannelId  ? `<#${settings.lurkerChannelId}>`  : '未設定';
    const chatterCh = settings.chatterChannelId ? `<#${settings.chatterChannelId}>` : '未設定（目覚ましチャンネルと共通）';
    const rssCh = settings.rssChannelId ? `<#${settings.rssChannelId}>` : '未設定';
    const vcRecruit = getVCRecruitSettings();
    const vcRecruitCh   = vcRecruit.channelId ? `<#${vcRecruit.channelId}>` : '未設定';
    const vcRecruitRole = vcRecruit.roleId    ? `<@&${vcRecruit.roleId}>`   : 'なし';
    const thinkerEnabled = settings.chineseThinkerReplace !== false;
    const thinkerExcl    = (settings.chineseThinkerExcludeUsers ?? []);
    const thinker        = thinkerEnabled
        ? `✅ 有効${thinkerExcl.length ? `（例外: ${thinkerExcl.map(id => `<@${id}>`).join(' ')}）` : ''}`
        : '🚫 無効';
    const chatterProviders  = getChatterProviderStatus().filter(p => p.configured);
    const chatterUsageStr   = chatterProviders.length
        ? chatterProviders.map(p => `${p.provider}: ${p.count}/${p.budget}回`).join('\n')
        : 'なし（APIキー未設定）';

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
            { name: '😴 目覚ましチャンネル',  value: lurkerCh,  inline: false },
            { name: '💬 賑やかしBot投稿チャンネル', value: chatterCh, inline: false },
            { name: '💬 雑談chatter 無料枠利用状況', value: chatterUsageStr, inline: false },
            { name: '📰 RSS投稿チャンネル', value: rssCh, inline: false },
            { name: '📣 VC募集投稿チャンネル', value: vcRecruitCh, inline: true },
            { name: '📣 VC募集メンションロール', value: vcRecruitRole, inline: true },
            { name: '🀄 中国思想家置き換え',  value: thinker,   inline: false },
            { name: '😿 Webhook化許可ユーザー', value: fmtUsers(settings.cryAllowedUsers), inline: false },
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
    if (!hasAdminPermission(interaction.member)) {
        return interaction.reply({ content: '管理者のみ実行できます。', ephemeral: true });
    }

    const group = interaction.options.getSubcommandGroup(false);
    const sub   = interaction.options.getSubcommand();

    // ── VC募集機能（サブコマンドグループ） ──
    if (group === 'vc_recruit') {
        if (sub === 'channel') {
            const ch       = interaction.options.getChannel('channel');
            const settings = getSettings();
            settings.vcRecruitChannelId = ch?.id ?? null;
            saveSettings(settings);
            const verb = ch ? `<#${ch.id}> に設定` : '解除（賑やかしBot投稿チャンネルと共通）';
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('📣 VC募集投稿チャンネル')
                        .setColor(ch ? COLOR.add : COLOR.remove)
                        .setDescription(verb)
                        .setTimestamp()
                ],
                ephemeral: true,
            });
        }

        if (sub === 'role') {
            const role     = interaction.options.getRole('role');
            const settings = getSettings();
            settings.vcRecruitRoleId = role?.id ?? null;
            saveSettings(settings);
            const verb = role ? `<@&${role.id}> に設定` : '解除（デフォルトロールに戻す）';
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('📣 VC募集メンションロール')
                        .setColor(role ? COLOR.add : COLOR.remove)
                        .setDescription(verb)
                        .setTimestamp()
                ],
                ephemeral: true,
            });
        }

        if (sub === 'test') {
            await interaction.deferReply({ ephemeral: true });
            await forceRecruitPost(interaction);
            return interaction.editReply({ content: '✅ このチャンネルにVC募集メッセージを投稿しました。' });
        }
        return;
    }

    // ── スパム自動処罰（サブコマンドグループ） ──
    if (group === 'spam') {
        if (sub === 'strikes') {
            const action = interaction.options.getString('action');
            const target = interaction.options.getUser('user');

            if (action === 'get') {
                const count = getStrikeCount(target.id);
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🚨 スパム違反カウント')
                            .setColor(count > 0 ? COLOR.deny : COLOR.info)
                            .setDescription(`<@${target.id}> の直近3日以内の違反回数: **${count}回**`)
                            .setTimestamp()
                    ],
                    ephemeral: true,
                });
            }

            if (action === 'reset') {
                const existed = resetStrikes(target.id);
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🚨 スパム違反カウント — リセット')
                            .setColor(COLOR.remove)
                            .setDescription(existed ? `<@${target.id}> の違反カウントをリセットしました。` : `<@${target.id}> に違反履歴はありません。`)
                            .setTimestamp()
                    ],
                    ephemeral: true,
                });
            }
            return;
        }

        if (sub === 'target_role') {
            const action     = interaction.options.getString('action');
            const targetRole = interaction.options.getRole('role');
            const settings   = getSettings();

            if (action === 'list') {
                const list = settings.spamTargetRoles ?? [];
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🚨 スパム自動処罰 — 適用対象ロール')
                            .setColor(COLOR.info)
                            .setDescription(list.length ? list.map(id => `<@&${id}>`).join(' ') : '未設定（誰にも適用されません）')
                            .setTimestamp()
                    ],
                    ephemeral: true,
                });
            }

            if (!targetRole) {
                return interaction.reply({ content: 'role を指定してください。', ephemeral: true });
            }

            const verb = action === 'add' ? '追加' : '解除';
            if (action === 'add') {
                if (!settings.spamTargetRoles.includes(targetRole.id)) settings.spamTargetRoles.push(targetRole.id);
            } else {
                settings.spamTargetRoles = settings.spamTargetRoles.filter(id => id !== targetRole.id);
            }
            saveSettings(settings);

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`🚨 スパム自動処罰 適用対象ロール — ${verb}`)
                        .setColor(action === 'add' ? COLOR.add : COLOR.remove)
                        .setDescription(`<@&${targetRole.id}>`)
                        .setTimestamp()
                ],
                ephemeral: true,
            });
        }
        return;
    }

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

    // ── 賑やかしBot投稿チャンネル ──
    if (sub === 'chatter_channel') {
        const ch       = interaction.options.getChannel('channel');
        const settings = getSettings();
        settings.chatterChannelId = ch?.id ?? null;
        saveSettings(settings);
        const verb = ch ? `<#${ch.id}> に設定` : '解除';
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('💬 賑やかしBot投稿チャンネル')
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

    // ── 中国思想家置き換えON/OFF・例外ユーザー管理 ──
    if (sub === 'chinese_thinker') {
        const settings = getSettings();
        if (!settings.chineseThinkerExcludeUsers) settings.chineseThinkerExcludeUsers = [];

        const enable     = interaction.options.getBoolean('enable');
        const action     = interaction.options.getString('action');
        const targetUser = interaction.options.getUser('user');

        // 例外ユーザー操作
        if (action && targetUser) {
            if (action === 'add') {
                if (!settings.chineseThinkerExcludeUsers.includes(targetUser.id))
                    settings.chineseThinkerExcludeUsers.push(targetUser.id);
            } else {
                settings.chineseThinkerExcludeUsers =
                    settings.chineseThinkerExcludeUsers.filter(id => id !== targetUser.id);
            }
            saveSettings(settings);
            const verb = action === 'add' ? '例外に追加' : '例外から解除';
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`🀄 中国思想家置き換え — ${verb}`)
                        .setColor(action === 'add' ? COLOR.add : COLOR.remove)
                        .setDescription(`<@${targetUser.id}>`)
                        .setTimestamp()
                ],
                ephemeral: true,
            });
        }

        // 例外ユーザー一覧
        if (action === 'list') {
            const list = settings.chineseThinkerExcludeUsers;
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🀄 中国思想家置き換え — 例外ユーザー一覧')
                        .setColor(COLOR.info)
                        .setDescription(list.length ? list.map(id => `<@${id}>`).join('\n') : 'なし')
                        .setTimestamp()
                ],
                ephemeral: true,
            });
        }

        // ON/OFF
        if (enable !== null) {
            settings.chineseThinkerReplace = enable;
            saveSettings(settings);
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🀄 中国思想家置き換え')
                        .setColor(enable ? COLOR.add : COLOR.remove)
                        .setDescription(enable ? '✅ 有効にしました' : '🚫 無効にしました')
                        .setTimestamp()
                ],
                ephemeral: true,
            });
        }

        return interaction.reply({ content: 'enable または action を指定してください。', ephemeral: true });
    }

    // ── 😿 Webhook化許可ユーザー管理 ──
    if (sub === 'cry_allow') {
        const action     = interaction.options.getString('action');
        const targetUser = interaction.options.getUser('user');
        const settings   = getSettings();
        if (!settings.cryAllowedUsers) settings.cryAllowedUsers = [];

        if (action === 'list') {
            const list = settings.cryAllowedUsers;
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('😿 Webhook化許可ユーザー一覧')
                        .setColor(COLOR.info)
                        .setDescription(list.length ? list.map(id => `<@${id}>`).join('\n') : 'なし')
                        .setTimestamp()
                ],
                ephemeral: true,
            });
        }

        if (!targetUser) {
            return interaction.reply({ content: 'ユーザーを指定してください。', ephemeral: true });
        }

        if (action === 'add') {
            if (!settings.cryAllowedUsers.includes(targetUser.id))
                settings.cryAllowedUsers.push(targetUser.id);
        } else {
            settings.cryAllowedUsers = settings.cryAllowedUsers.filter(id => id !== targetUser.id);
        }
        saveSettings(settings);

        const verb = action === 'add' ? '許可に追加' : '許可から解除';
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(`😿 Webhook化 — ${verb}`)
                    .setColor(action === 'add' ? COLOR.add : COLOR.remove)
                    .setDescription(`<@${targetUser.id}>`)
                    .setTimestamp()
            ],
            ephemeral: true,
        });
    }

    // ── RSS投稿チャンネル ──
    if (sub === 'rss_channel') {
        const ch       = interaction.options.getChannel('channel');
        const settings = getSettings();
        settings.rssChannelId = ch?.id ?? null;
        saveSettings(settings);
        const verb = ch ? `<#${ch.id}> に設定` : '解除';
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('📰 RSS投稿チャンネル')
                    .setColor(ch ? COLOR.add : COLOR.remove)
                    .setDescription(verb)
                    .setTimestamp()
            ],
            ephemeral: true,
        });
    }

    // ── メッセージ編集アラート除外 ──
    if (sub === 'edit_monitor_exclude') {
        const action     = interaction.options.getString('action');
        const targetUser = interaction.options.getUser('user');
        const targetRole = interaction.options.getRole('role');
        const settings   = getSettings();

        if (action === 'list') {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('📝 メッセージ編集アラート — 除外一覧')
                        .setColor(COLOR.info)
                        .addFields(
                            { name: '👤 ユーザー', value: settings.editMonitorExcludedUsers.length ? settings.editMonitorExcludedUsers.map(id => `<@${id}>`).join(' ') : 'なし', inline: false },
                            { name: '👥 ロール',   value: settings.editMonitorExcludedRoles.length ? settings.editMonitorExcludedRoles.map(id => `<@&${id}>`).join(' ') : 'なし', inline: false },
                        )
                        .setTimestamp()
                ],
                ephemeral: true,
            });
        }

        if (!targetUser && !targetRole) {
            return interaction.reply({ content: 'ユーザーかロールを指定してください。', ephemeral: true });
        }

        const verb  = action === 'add' ? '追加' : '解除';
        const lines = [];
        if (targetUser) {
            if (action === 'add') {
                if (!settings.editMonitorExcludedUsers.includes(targetUser.id)) settings.editMonitorExcludedUsers.push(targetUser.id);
            } else {
                settings.editMonitorExcludedUsers = settings.editMonitorExcludedUsers.filter(id => id !== targetUser.id);
            }
            lines.push(`👤 <@${targetUser.id}>`);
        }
        if (targetRole) {
            if (action === 'add') {
                if (!settings.editMonitorExcludedRoles.includes(targetRole.id)) settings.editMonitorExcludedRoles.push(targetRole.id);
            } else {
                settings.editMonitorExcludedRoles = settings.editMonitorExcludedRoles.filter(id => id !== targetRole.id);
            }
            lines.push(`👥 <@&${targetRole.id}>`);
        }
        saveSettings(settings);

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(`📝 メッセージ編集アラート除外 — ${verb}`)
                    .setColor(action === 'add' ? COLOR.add : COLOR.remove)
                    .setDescription(lines.join('\n'))
                    .setTimestamp()
            ],
            ephemeral: true,
        });
    }

    // ── 賑やかしchatterの試し打ち ──
    if (sub === 'chatter') {
        await interaction.deferReply({ ephemeral: true });
        const result = await forceChatterPost(interaction);
        if (!result.ok) {
            return interaction.editReply({ content: `❌ ${result.reason}` });
        }
        return interaction.editReply({
            content: `✅ このチャンネルに投稿しました。\n生成方法: **${result.source}** / なりすまし: **${result.lurkerName}**\n> ${result.content}`,
        });
    }

    // ── Bump DMリマインド対象 ──
    if (sub === 'remind') {
        return handleBumpRemindCommand(interaction);
    }

    // ── XPランキング発表チャンネル ──
    if (sub === 'ranking_channel') {
        const ch       = interaction.options.getChannel('channel');
        const settings = getSettings();
        settings.rankingChannelId = ch?.id ?? null;
        saveSettings(settings);
        const verb = ch ? `<#${ch.id}> に設定しました` : '解除しました';
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('🏆 XPランキング発表チャンネル')
                    .setColor(ch ? COLOR.add : COLOR.remove)
                    .setDescription(verb)
                    .setTimestamp()
            ],
            ephemeral: true,
        });
    }

    // ── しりとりチャンネル ──
    if (sub === 'shiritori_channel') {
        const ch       = interaction.options.getChannel('channel');
        const settings = getSettings();
        settings.shiritoriChannelId = ch?.id ?? null;
        saveSettings(settings);
        resetShiritoriGame(ch?.id);
        const verb = ch ? `<#${ch.id}> に設定しました（ゲームをリセットしました）` : '解除しました';
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('🔤 しりとりチャンネル')
                    .setColor(ch ? COLOR.add : COLOR.remove)
                    .setDescription(verb)
                    .setTimestamp()
            ],
            ephemeral: true,
        });
    }

    // ── 臨時NGワード管理 ──
    if (sub === 'ng_word') {
        const action = interaction.options.getString('action');
        const word   = interaction.options.getString('word');
        const durationMinutes = interaction.options.getInteger('duration_minutes');

        if (action === 'list') {
            const words = getNgWords();
            const desc = words.length
                ? words.map(w => `\`${w.word}\`${w.expiresAt ? ` — <t:${Math.floor(w.expiresAt / 1000)}:R> まで` : ' — 無期限'}`).join('\n')
                : 'なし';
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🚫 臨時NGワード一覧')
                        .setColor(COLOR.info)
                        .setDescription(desc)
                        .setTimestamp()
                ],
                ephemeral: true,
            });
        }

        if (!word) {
            return interaction.reply({ content: 'word を指定してください。', ephemeral: true });
        }

        if (action === 'add') {
            addNgWord(word, interaction.user.id, durationMinutes);
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🚫 臨時NGワード — 追加')
                        .setColor(COLOR.add)
                        .setDescription(`\`${word}\` を追加しました。\n${durationMinutes ? `⏰ ${durationMinutes}分後に自動失効` : '♾️ 無期限（手動削除まで有効）'}`)
                        .setTimestamp()
                ],
                ephemeral: true,
            });
        }

        if (action === 'remove') {
            const removed = removeNgWord(word);
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🚫 臨時NGワード — 削除')
                        .setColor(removed ? COLOR.remove : COLOR.deny)
                        .setDescription(removed ? `\`${word}\` を削除しました。` : `\`${word}\` は登録されていません。`)
                        .setTimestamp()
                ],
                ephemeral: true,
            });
        }
    }

    // ── 1day-RTAチャンネル ──
    if (sub === 'rta_channel') {
        const ch       = interaction.options.getChannel('channel');
        const settings = getSettings();
        settings.rtaChannelId = ch?.id ?? null;
        saveSettings(settings);
        resetRtaRace();
        const verb = ch ? `<#${ch.id}> に設定しました（本日分をリセットしました）` : '解除しました';
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('🏁 1day-RTAチャンネル')
                    .setColor(ch ? COLOR.add : COLOR.remove)
                    .setDescription(verb)
                    .setTimestamp()
            ],
            ephemeral: true,
        });
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

    // ── 無活動キック ──
    if (sub === 'kick_inactive') {
        return handleKickInactive(interaction);
    }

    // ── 全員のタイムアウト解除 ──
    if (sub === 'timeout_remove') {
        await interaction.deferReply({ ephemeral: true });
        const members = await interaction.guild.members.fetch();
        const timedOut = members.filter(m => m.communicationDisabledUntilTimestamp && m.communicationDisabledUntilTimestamp > Date.now());

        if (timedOut.size === 0) {
            return interaction.editReply('タイムアウト中のメンバーはいません。');
        }

        let ok = 0, fail = 0;
        for (const member of timedOut.values()) {
            await member.timeout(null, `admin timeout_remove by ${interaction.user.tag}`)
                .then(() => ok++)
                .catch(() => fail++);
        }

        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('🔓 全員タイムアウト解除')
                    .setColor(COLOR.add)
                    .setDescription(`✅ **${ok}** 人のタイムアウトを解除しました。${fail ? `\n⚠️ ${fail} 人は権限不足により解除できませんでした。` : ''}`)
                    .setTimestamp()
            ],
        });
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
    if (!hasAdminPermission(interaction.member)) {
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
    if (!hasAdminPermission(interaction.member)) {
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
    if (!hasAdminPermission(interaction.member)) {
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

/* =========================
   📡 プレゼンス変更
========================= */
const PRESENCE_LABELS = {
    online:    '🟢 オンライン',
    idle:      '🌙 退席中',
    dnd:       '⛔ 取り込み中',
    invisible: '⚫ オフライン',
    mobile:    '📱 モバイル',
};

async function handlePresence(interaction) {
    if (!hasAdminPermission(interaction.member)) {
        return interaction.reply({ content: '管理者のみ実行できます。', ephemeral: true });
    }

    const status = interaction.options.getString('status');

    if (status === 'mobile') {
        await interaction.deferReply({ ephemeral: true });
        savePresence({ status: 'mobile' });
        // browser を Discord Android に書き換えて再接続するとモバイル表示になる
        interaction.client.options.ws = {
            ...(interaction.client.options.ws ?? {}),
            properties: { browser: 'Discord Android' },
        };
        await interaction.client.destroy();
        await interaction.client.login(process.env.DISCORD_TOKEN);
        await interaction.followUp({ content: `✅ ステータスを **${PRESENCE_LABELS.mobile}** に変更しました。`, ephemeral: true });
        return;
    }

    savePresence({ status });
    interaction.client.user.setPresence({ status });
    console.info(`[PRESENCE] ステータス変更: ${status} by ${interaction.user.tag}`);
    return interaction.reply({
        content: `✅ ステータスを **${PRESENCE_LABELS[status] ?? status}** に変更しました。`,
        ephemeral: true,
    });
}

/* =========================
   🔥 コマンドハンドラ その2（/adminのサブコマンド上限対策）
========================= */
async function handleAdmin2(interaction) {
    if (!hasAdminPermission(interaction.member)) {
        return interaction.reply({ content: '管理者のみ実行できます。', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'chatter_ai') {
        const provider     = interaction.options.getString('provider');
        const model        = interaction.options.getString('model');
        const dailyBudget  = interaction.options.getInteger('daily_budget');
        const settings = getSettings();

        if (provider) settings.chatterAiProvider = provider;
        if (model)    settings.chatterAiModel    = model;
        if (dailyBudget != null) {
            const targetProvider = provider && provider !== 'auto' ? provider : null;
            if (!targetProvider) {
                return interaction.reply({
                    content: '❌ daily_budgetを設定する場合は、provider（groq/cloudflare/geminiのいずれか）も一緒に指定してください。',
                    ephemeral: true,
                });
            }
            if (!settings.chatterDailyBudgets) settings.chatterDailyBudgets = {};
            settings.chatterDailyBudgets[targetProvider] = dailyBudget;
        }
        if (provider || model || dailyBudget != null) saveSettings(settings);

        const providerLines = getChatterProviderStatus()
            .map(p => `${p.configured ? '✅' : '🚫'} ${p.provider}: ${p.count}/${p.budget}回${p.configured ? '' : '（APIキー未設定）'}`)
            .join('\n');

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('💬 雑談chatter — AI設定')
                    .setColor(COLOR.info)
                    .setDescription(
                        `プロバイダー設定: **${settings.chatterAiProvider}**${settings.chatterAiProvider === 'auto' ? '（利用可能なプロバイダーを自動ローテーション）' : ''}\n` +
                        `モデル: **${settings.chatterAiModel || '(プロバイダーのデフォルト。autoでは各プロバイダー個別のデフォルトを使用)'}**\n\n` +
                        `本日の利用状況（日本時間0時リセット）:\n${providerLines}`
                    )
                    .setTimestamp()
            ],
            ephemeral: true,
        });
    }

    if (sub === 'chatter_persona_reset') {
        const slot = interaction.options.getString('slot');
        const slots = slot === 'all' ? ['main', 'critic', 'mount', 'groom', 'spam', 'animal'] : [slot];
        slots.forEach(s => resetChatterPersona(s));

        return interaction.reply({
            content: `✅ chatterの固定キャラ（${slots.join(', ')}）をリセットしました。次回の投稿時に再抽選されます。`,
            ephemeral: true,
        });
    }
}

module.exports = { handleAdmin, handleAdmin2, handleAdminButton, handleServersLeaveSelect, handleServersLeaveConfirm, handleServersLeaveCancel, handlePresence, restorePresence };
