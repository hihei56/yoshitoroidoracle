// bump.js — Disboard /bump クールダウン管理・リマインダー
const { EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const DISBOARD_BOT_ID   = '302050872383242240';
const BUMP_COOLDOWN_MS  = 2 * 60 * 60 * 1000; // 2時間
const DEFAULT_REMIND_MIN = 10;
const HISTORY_LIMIT      = 20;
const TICK_INTERVAL_MS   = 30 * 1000;
const NUDGE_INTERVAL_MS  = 60 * 60 * 1000; // Bump可能なのに放置されている間、催促DMを送る間隔

// Bump通知で誘導するチャンネルへのリンク
const BUMP_GUIDE_LINK = 'https://discord.com/channels/1476939502319698054/1521850350951207094';
const BUMP_GUIDE_LINE = `\n\n👉 [こちらのチャンネルで \`/bump\` を実行してください](${BUMP_GUIDE_LINK})`;

const STATE_PATH = resolveDataPath('bump_state.json');
ensureDir(STATE_PATH);

function loadState() {
    return readJson(STATE_PATH, {});
}

function saveState(state) {
    writeJson(STATE_PATH, state);
}

function getGuildState(state, guildId) {
    if (!state[guildId]) {
        state[guildId] = {
            channelId: null,
            remindMinutes: DEFAULT_REMIND_MIN,
            cooldownEnd: null,
            lastBumpedBy: null,
            lastBumpedAt: null,
            remindedSent: false,
            availableNotifiedSent: false,
            lastNudgeAt: null,
            history: [],
            remindUsers: [],
            totalBumps: 0,
        };
    }
    return state[guildId];
}

function hasManagePermission(member) {
    if (!member) return false;
    if (member.id === member.guild.ownerId) return true;
    return member.permissions.has(PermissionsBitField.Flags.ManageGuild)
        || member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function formatDuration(ms) {
    if (ms <= 0) return '0分';
    const totalMinutes = Math.ceil(ms / 60000);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h <= 0) return `${m}分`;
    if (m <= 0) return `${h}時間`;
    return `${h}時間${m}分`;
}

/* =========================
   📨 チャンネル送信（エラーハンドリング込み）
========================= */
async function sendToChannel(client, channelId, payload) {
    if (!channelId) return false;
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return false;
        if (channel.guild) {
            const me = channel.guild.members.me;
            const perms = me ? channel.permissionsFor(me) : null;
            if (perms && (!perms.has(PermissionsBitField.Flags.ViewChannel) || !perms.has(PermissionsBitField.Flags.SendMessages))) {
                console.error(`[Bump] チャンネル ${channelId} への閲覧/送信権限がありません`);
                return false;
            }
        }
        await channel.send(payload);
        return true;
    } catch (e) {
        console.error(`[Bump] チャンネル送信エラー (channel:${channelId}):`, e.message);
        return false;
    }
}

/* =========================
   📩 DMリマインド対象ユーザー管理
========================= */
function addRemindUser(guildId, userId) {
    const state = loadState();
    const g = getGuildState(state, guildId);
    if (!g.remindUsers) g.remindUsers = [];
    if (!g.remindUsers.includes(userId)) g.remindUsers.push(userId);
    saveState(state);
}

function removeRemindUser(guildId, userId) {
    const state = loadState();
    const g = getGuildState(state, guildId);
    g.remindUsers = (g.remindUsers ?? []).filter(id => id !== userId);
    saveState(state);
}

function getRemindUsers(guildId) {
    const state = loadState();
    return state[guildId]?.remindUsers ?? [];
}

async function dmRemindUsers(client, guildId, embed) {
    const userIds = getRemindUsers(guildId);
    for (const userId of userIds) {
        try {
            const user = await client.users.fetch(userId);
            await user.send({ embeds: [embed] });
        } catch (e) {
            console.error(`[Bump] DM送信失敗 (user:${userId}):`, e.message);
        }
    }
}

/* =========================
   🔍 Disboard /bump 成功メッセージ検知
========================= */
async function handleBumpMessage(message) {
    try {
        if (!message.guild) return;
        if (message.author.id !== DISBOARD_BOT_ID) return;

        const embed = message.embeds?.[0];
        const desc = embed?.description ?? '';
        // Disboardはユーザーのロケールにより日本語（表示順をアップしたよ）/ 英語（Bump done）の両方を返す
        if (!/bump\s*done/i.test(desc) && !desc.includes('表示順をアップしたよ')) return;

        const bumper = message.interactionMetadata?.user ?? message.interaction?.user ?? null;

        const state = loadState();
        const g = getGuildState(state, message.guild.id);

        const now = Date.now();
        g.cooldownEnd = now + BUMP_COOLDOWN_MS;
        g.lastBumpedBy = bumper ? { id: bumper.id, tag: bumper.tag } : null;
        g.lastBumpedAt = now;
        g.remindedSent = false;
        g.availableNotifiedSent = false;
        g.lastNudgeAt = null;
        g.totalBumps = (g.totalBumps ?? 0) + 1;
        g.history.unshift({
            userId: bumper?.id ?? null,
            userTag: bumper?.tag ?? '不明なユーザー',
            bumpedAt: now,
        });
        if (g.history.length > HISTORY_LIMIT) g.history.length = HISTORY_LIMIT;

        saveState(state);
        console.log(`[Bump] 検知: guild=${message.guild.id} by=${bumper?.tag ?? '不明'}`);

        if (g.channelId) {
            const nextAt = Math.floor(g.cooldownEnd / 1000);
            const embedReply = new EmbedBuilder()
                .setTitle('👍 Bump ありがとうございます！')
                .setDescription(
                    `${bumper ? `<@${bumper.id}>` : '誰か'} が Bump しました。\n次回は <t:${nextAt}:f>（<t:${nextAt}:R>）に実行できます。`
                )
                .setColor(0x57F287)
                .setTimestamp();
            await sendToChannel(message.client, g.channelId, { embeds: [embedReply] });
        }
    } catch (e) {
        console.error('[Bump] 検知処理エラー:', e);
    }
}

/* =========================
   ⏰ 定期チェック（リマインド・通知）
========================= */
async function tick(client) {
    try {
        const state = loadState();
        const now = Date.now();
        let changed = false;

        for (const [guildId, g] of Object.entries(state)) {
            if (!g.channelId || !g.cooldownEnd) continue;
            const remainMs = g.cooldownEnd - now;
            const remindWindowMs = (g.remindMinutes ?? DEFAULT_REMIND_MIN) * 60 * 1000;

            if (!g.remindedSent && remainMs > 0 && remainMs <= remindWindowMs) {
                const nextAt = Math.floor(g.cooldownEnd / 1000);
                const embed = new EmbedBuilder()
                    .setTitle('⏰ まもなく Bump 可能です')
                    .setDescription(`あと **${formatDuration(remainMs)}** で Bump 可能になります。（<t:${nextAt}:R>）${BUMP_GUIDE_LINE}`)
                    .setColor(0xFEE75C)
                    .setTimestamp();
                const ok = await sendToChannel(client, g.channelId, { embeds: [embed] });
                if (ok) {
                    g.remindedSent = true;
                    changed = true;
                    await dmRemindUsers(client, guildId, embed);
                }
            }

            if (!g.availableNotifiedSent && remainMs <= 0) {
                const embed = new EmbedBuilder()
                    .setTitle('✅ Bump 可能になりました！')
                    .setDescription(`\`/bump\` を実行してサーバーの表示順位を上げましょう！${BUMP_GUIDE_LINE}`)
                    .setColor(0x57F287)
                    .setTimestamp();
                const ok = await sendToChannel(client, g.channelId, { embeds: [embed] });
                if (ok) {
                    g.availableNotifiedSent = true;
                    g.lastNudgeAt = now;
                    changed = true;
                    await dmRemindUsers(client, guildId, embed);
                }
            } else if (g.availableNotifiedSent && remainMs <= 0) {
                // Bump可能なのに誰もBumpしていない間、1時間おきに催促DMを送り続ける
                const nudgeDue = !g.lastNudgeAt || (now - g.lastNudgeAt >= NUDGE_INTERVAL_MS);
                if (nudgeDue && (g.remindUsers?.length ?? 0) > 0) {
                    const nudgeEmbed = new EmbedBuilder()
                        .setTitle('📣 まだBumpされていません')
                        .setDescription(`Bump可能な状態が続いています。空いた時間に \`/bump\` をお願いします！${BUMP_GUIDE_LINE}`)
                        .setColor(0xED4245)
                        .setTimestamp();
                    await dmRemindUsers(client, guildId, nudgeEmbed);
                    g.lastNudgeAt = now;
                    changed = true;
                }
            }
        }

        if (changed) saveState(state);
    } catch (e) {
        console.error('[Bump] tick エラー:', e);
    }
}

function initBump(client) {
    setInterval(() => tick(client).catch(e => console.error('[Bump] tick 呼び出しエラー:', e)), TICK_INTERVAL_MS);
    setTimeout(() => tick(client).catch(e => console.error('[Bump] 初回tick エラー:', e)), 5_000);
    console.log('[Bump] ✅ リマインダースケジューラ 開始');
}

/* =========================
   💬 /bump-setup
========================= */
async function handleBumpSetup(interaction) {
    try {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        }
        if (!hasManagePermission(interaction.member)) {
            return interaction.reply({ content: '❌ このコマンドを使用するには「サーバー管理」権限が必要です。', ephemeral: true });
        }

        const channel = interaction.options.getChannel('channel');
        const remindMinutes = interaction.options.getInteger('remind_minutes') ?? DEFAULT_REMIND_MIN;

        if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
            return interaction.reply({ content: '❌ テキストチャンネルを指定してください。', ephemeral: true });
        }

        const state = loadState();
        const g = getGuildState(state, interaction.guild.id);
        g.channelId = channel.id;
        g.remindMinutes = remindMinutes;
        saveState(state);

        let warning = '';
        try {
            const me = interaction.guild.members.me;
            const perms = me ? channel.permissionsFor(me) : null;
            if (!perms || !perms.has(PermissionsBitField.Flags.ViewChannel) || !perms.has(PermissionsBitField.Flags.SendMessages) || !perms.has(PermissionsBitField.Flags.EmbedLinks)) {
                warning = '\n⚠️ このチャンネルへの閲覧/送信/Embed権限が不足している可能性があります。';
            } else {
                await channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🔔 Bump リマインダー設定完了')
                            .setDescription(`このチャンネルに Bump のリマインダーを送信します。\nリマインド時間: Bump可能になる **${remindMinutes}分前**`)
                            .setColor(0x5865F2)
                            .setTimestamp(),
                    ],
                });
            }
        } catch (e) {
            warning = '\n⚠️ テスト通知の送信に失敗しました。チャンネル権限を確認してください。';
            console.error('[Bump] setup テスト送信エラー:', e.message);
        }

        return interaction.reply({
            content: `✅ Bump リマインダーチャンネルを ${channel} に設定しました。（${remindMinutes}分前に通知）${warning}`,
            ephemeral: true,
        });
    } catch (e) {
        console.error('[Bump] setup エラー:', e);
        return interaction.reply({ content: '❌ 設定中にエラーが発生しました。', ephemeral: true }).catch(() => {});
    }
}

/* =========================
   💬 /bump-status
========================= */
async function handleBumpStatus(interaction) {
    try {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        }

        const state = loadState();
        const g = state[interaction.guild.id];

        if (!g || !g.channelId) {
            return interaction.reply({ content: 'ℹ️ まだ `/bump-setup` で設定されていません。', ephemeral: true });
        }

        const now = Date.now();
        const remainMs = g.cooldownEnd ? g.cooldownEnd - now : null;
        const isReady = !g.cooldownEnd || remainMs <= 0;

        const fields = [
            { name: '状態', value: isReady ? '✅ Bump 可能です' : `⏳ クールダウン中（残り ${formatDuration(remainMs)}）`, inline: false },
            { name: '通知チャンネル', value: `<#${g.channelId}>`, inline: true },
            { name: 'リマインド設定', value: `${g.remindMinutes ?? DEFAULT_REMIND_MIN}分前`, inline: true },
            { name: '累計Bump回数', value: `${g.totalBumps ?? 0}回`, inline: true },
        ];

        if (g.cooldownEnd) {
            const nextAt = Math.floor(g.cooldownEnd / 1000);
            fields.push({ name: '次回Bump可能時刻', value: `<t:${nextAt}:f>（<t:${nextAt}:R>）`, inline: false });
        }

        if (g.lastBumpedAt) {
            const lastAt = Math.floor(g.lastBumpedAt / 1000);
            const who = g.lastBumpedBy ? `<@${g.lastBumpedBy.id}> (${g.lastBumpedBy.tag})` : '不明なユーザー';
            fields.push({ name: '前回のBump', value: `${who} — <t:${lastAt}:R>`, inline: false });
        }

        const embed = new EmbedBuilder()
            .setTitle('📊 Bump クールダウン状況')
            .addFields(fields)
            .setColor(isReady ? 0x57F287 : 0xFEE75C)
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    } catch (e) {
        console.error('[Bump] status エラー:', e);
        return interaction.reply({ content: '❌ 状態の取得中にエラーが発生しました。', ephemeral: true }).catch(() => {});
    }
}

/* =========================
   💬 /bump-force-notify（管理者のみ）
========================= */
async function handleBumpForceNotify(interaction) {
    try {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        }
        if (!hasManagePermission(interaction.member)) {
            return interaction.reply({ content: '❌ このコマンドを使用するには「サーバー管理」権限が必要です。', ephemeral: true });
        }

        const state = loadState();
        const g = state[interaction.guild.id];
        if (!g || !g.channelId) {
            return interaction.reply({ content: 'ℹ️ まだ `/bump-setup` で通知チャンネルが設定されていません。', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('📢 Bump 通知（強制送信）')
            .setDescription(`管理者 <@${interaction.user.id}> による強制通知です。\n\`/bump\` を実行できるか確認してください。${BUMP_GUIDE_LINE}`)
            .setColor(0xEB459E)
            .setTimestamp();

        const ok = await sendToChannel(interaction.client, g.channelId, { embeds: [embed] });
        if (!ok) {
            return interaction.reply({ content: '❌ 通知チャンネルへの送信に失敗しました。権限を確認してください。', ephemeral: true });
        }
        await dmRemindUsers(interaction.client, interaction.guild.id, embed);

        return interaction.reply({ content: `✅ <#${g.channelId}> に強制通知を送信しました。`, ephemeral: true });
    } catch (e) {
        console.error('[Bump] force-notify エラー:', e);
        return interaction.reply({ content: '❌ 通知送信中にエラーが発生しました。', ephemeral: true }).catch(() => {});
    }
}

/* =========================
   💬 /bump-history
========================= */
async function handleBumpHistory(interaction) {
    try {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        }

        const count = interaction.options.getInteger('count') ?? 5;
        const state = loadState();
        const g = state[interaction.guild.id];

        if (!g || !g.history?.length) {
            return interaction.reply({ content: 'ℹ️ まだ Bump の記録がありません。', ephemeral: true });
        }

        const lines = g.history.slice(0, count).map((h, i) => {
            const at = Math.floor(h.bumpedAt / 1000);
            const who = h.userId ? `<@${h.userId}> (${h.userTag})` : (h.userTag ?? '不明なユーザー');
            return `**${i + 1}.** ${who} — <t:${at}:f>`;
        });

        const embed = new EmbedBuilder()
            .setTitle('📋 Bump 実行履歴')
            .setDescription(lines.join('\n'))
            .setColor(0x5865F2)
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    } catch (e) {
        console.error('[Bump] history エラー:', e);
        return interaction.reply({ content: '❌ 履歴の取得中にエラーが発生しました。', ephemeral: true }).catch(() => {});
    }
}

/* =========================
   💬 /admin remind（DMリマインド対象の管理）
========================= */
async function handleBumpRemindCommand(interaction) {
    try {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        }

        const action     = interaction.options.getString('action');
        const targetUser = interaction.options.getUser('user');
        const guildId    = interaction.guild.id;

        if (action === 'list') {
            const users = getRemindUsers(guildId);
            return interaction.reply({
                content: users.length
                    ? `📋 Bump DMリマインド登録者:\n${users.map(id => `<@${id}>`).join('\n')}`
                    : 'ℹ️ 登録者はいません。',
                ephemeral: true,
            });
        }

        if (!targetUser) {
            return interaction.reply({ content: 'user を指定してください。', ephemeral: true });
        }

        if (action === 'add') {
            addRemindUser(guildId, targetUser.id);
            return interaction.reply({ content: `✅ <@${targetUser.id}> をBumpのDMリマインド対象に追加しました。`, ephemeral: true });
        }

        if (action === 'remove') {
            removeRemindUser(guildId, targetUser.id);
            return interaction.reply({ content: `✅ <@${targetUser.id}> をBumpのDMリマインド対象から解除しました。`, ephemeral: true });
        }
    } catch (e) {
        console.error('[Bump] remind コマンドエラー:', e);
        return interaction.reply({ content: '❌ 処理中にエラーが発生しました。', ephemeral: true }).catch(() => {});
    }
}

module.exports = {
    initBump,
    handleBumpMessage,
    handleBumpSetup,
    handleBumpStatus,
    handleBumpForceNotify,
    handleBumpHistory,
    handleBumpRemindCommand,
};
