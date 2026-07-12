// spam_enforcer.js — 頻発スパムユーザーへの累進処罰（削除→タイムアウト延長→キック）
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');
const { getModExcludeList } = require('./exclude_manager');
const { getSettings } = require('./config');
const whStore = require('./webhook_store');

const STRIKES_PATH = resolveDataPath('spam_strikes.json');
ensureDir(STRIKES_PATH);

const LOG_CHANNEL_ID = process.env.SPAM_LOG_CHANNEL_ID || '1476943641242239056';
const ALERT_WEBHOOK_NAME = 'アンチスパム';

// 適用対象ロール保持者は「既に悪質」と判断された相手のため、通常のモデレーションより
// 遥かに長く違反を記憶し、猶予なく処罰する
const STRIKE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14日

// 累積違反回数 → 処罰（分単位のタイムアウト、または 'kick'）。1回目から即タイムアウト（猶予なし）
const ESCALATION = [10, 60, 360, 1440, 40320, 'kick'];

let strikes = readJson(STRIKES_PATH, {});

function save() {
    writeJson(STRIKES_PATH, strikes);
}

function isExempt(member) {
    if (!member) return true;
    if (member.permissions.has('Administrator')) return true;
    const excl = getModExcludeList();
    if (excl.users.includes(member.id)) return true;
    if (excl.roles.some(id => member.roles.cache.has(id))) return true;

    // 適用対象ロールを持つメンバーにのみ適用する（未設定 = 誰にも適用しない）
    const targetRoles = getSettings().spamTargetRoles ?? [];
    if (!targetRoles.some(id => member.roles.cache.has(id))) return true;

    return false;
}

function bumpStrike(userId) {
    const now = Date.now();
    const rec = strikes[userId];
    if (!rec || now - rec.lastAt > STRIKE_WINDOW_MS) {
        strikes[userId] = { count: 1, lastAt: now };
    } else {
        rec.count += 1;
        rec.lastAt = now;
    }
    save();
    return strikes[userId].count;
}

function getStrikeCount(userId) {
    const rec = strikes[userId];
    if (!rec || Date.now() - rec.lastAt > STRIKE_WINDOW_MS) return 0;
    return rec.count;
}

function resetStrikes(userId) {
    const existed = !!strikes[userId];
    delete strikes[userId];
    save();
    return existed;
}

function formatMinutes(min) {
    if (min < 60) return `${min}分`;
    if (min < 1440) return `${Math.round(min / 60)}時間`;
    return `${Math.round(min / 1440)}日`;
}

async function postLog(message, count, action, category) {
    if (!LOG_CHANNEL_ID || !message.client) return;
    try {
        const ch = await message.client.channels.fetch(LOG_CHANNEL_ID);
        if (!ch) return;
        const actionLabel = action === null ? '削除のみ'
            : action === 'kick' ? 'キック'
            : `タイムアウト ${formatMinutes(action)}`;
        const embed = new EmbedBuilder()
            .setTitle('🚨 スパム取り締まり')
            .setColor(action === 'kick' ? 0x2b2d31 : action === null ? 0xFEE75C : 0xED4245)
            .addFields(
                { name: '対象',       value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
                { name: '違反回数',   value: `${count}回`, inline: true },
                { name: '処罰',       value: actionLabel, inline: true },
                { name: '種別',       value: category, inline: true },
                { name: 'チャンネル', value: `<#${message.channelId}>`, inline: true },
            )
            .setTimestamp();
        await ch.send({ embeds: [embed] });
    } catch (e) {
        console.error('[SpamEnforcer] ログ送信失敗:', e.message);
    }
}

/* =========================
   ⚡ 連投スパム検知（適用対象ロール保持者のみ・極めて厳格な基準）
   moderator.js の checkSpam は全メンバー向けの一般的な閾値のため、
   「既に悪質」と判定された対象ロール保持者にはここで独立かつ大幅に厳しい基準を適用する
========================= */
const FLOOD_WINDOW_MS = 4_000;
const FLOOD_THRESHOLD = 2; // 4秒以内に2通で即スパム判定

const floodTracker = new Map();

function isFlooding(userId) {
    const now   = Date.now();
    const times = (floodTracker.get(userId) || []).filter(t => now - t < FLOOD_WINDOW_MS);
    times.push(now);
    floodTracker.set(userId, times);
    return times.length >= FLOOD_THRESHOLD;
}

setInterval(() => {
    const now = Date.now();
    for (const [id, times] of floodTracker) {
        if (times.every(t => now - t >= FLOOD_WINDOW_MS)) floodTracker.delete(id);
    }
}, 60_000);

async function checkFloodSpam(message) {
    try {
        if (!message.guild || message.author.bot) return;

        const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
        if (isExempt(member)) return; // 対象ロール外・除外設定なら何もしない

        if (!isFlooding(message.author.id)) return;

        if (message.deletable) await message.delete().catch(() => {});
        await enforce(message, 'flood');
    } catch (e) {
        console.error('[SpamEnforcer] 連投検知エラー:', e);
    }
}

/* =========================
   🚨 対応ボタン付きアラート（Webhook表示）
========================= */
let alertWebhookPromise = null;

async function getAlertWebhook(client) {
    const cached = whStore.get(LOG_CHANNEL_ID);
    if (cached) return cached;
    if (alertWebhookPromise) return alertWebhookPromise;

    alertWebhookPromise = (async () => {
        try {
            const ch = await client.channels.fetch(LOG_CHANNEL_ID);
            if (!ch) return null;
            const hooks = await ch.fetchWebhooks();
            let wh = hooks.find(h => h.token);
            if (!wh) wh = await ch.createWebhook({ name: ALERT_WEBHOOK_NAME });
            whStore.set(LOG_CHANNEL_ID, wh);
            return whStore.get(LOG_CHANNEL_ID);
        } catch (e) {
            console.error('[SpamEnforcer] Webhook取得失敗:', e.message);
            return null;
        } finally {
            alertWebhookPromise = null;
        }
    })();
    return alertWebhookPromise;
}

async function postInteractiveAlert(message, minutes) {
    if (!LOG_CHANNEL_ID || !message.client) return;
    try {
        const wh = await getAlertWebhook(message.client);
        if (!wh) return;

        const embed = new EmbedBuilder()
            .setColor(0xEB459E)
            .setTitle('アンチスパム')
            .setDescription(`<@${message.author.id}> はスパムの可能性があるためタイムアウトされました（${formatMinutes(minutes)}）\nどうしますか？`)
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`spamenf_ban_${message.author.id}`).setLabel('BAN').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`spamenf_release_${message.author.id}`).setLabel('解除').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`spamenf_delban_${message.channelId}_${message.author.id}`).setLabel('メッセージ削除&BAN').setStyle(ButtonStyle.Danger),
        );

        await wh.send({
            username:        ALERT_WEBHOOK_NAME,
            avatarURL:       message.client.user.displayAvatarURL(),
            embeds:          [embed],
            components:      [row],
            allowedMentions: { parse: ['users'] },
        });
    } catch (e) {
        console.error('[SpamEnforcer] アラート送信失敗:', e.message);
    }
}

async function finalizeAlert(interaction, resultText) {
    const original    = interaction.message;
    const sourceEmbed = original.embeds[0];
    const embed = sourceEmbed
        ? EmbedBuilder.from(sourceEmbed).addFields({ name: '対応結果', value: resultText })
        : new EmbedBuilder().setDescription(resultText);

    const disabledRows = original.components.map(row =>
        new ActionRowBuilder().addComponents(row.components.map(c => ButtonBuilder.from(c).setDisabled(true)))
    );

    await interaction.editReply({ embeds: [embed], components: disabledRows });
}

async function handleSpamEnforcerButton(interaction) {
    if (!interaction.customId.startsWith('spamenf_')) return false;
    if (!interaction.inGuild()) return true;

    if (!interaction.member?.permissions?.has('Administrator')) {
        await interaction.reply({ content: '❌ このボタンはサーバー管理者権限を持つ人のみ使用できます。', ephemeral: true });
        return true;
    }

    const [, action, ...rest] = interaction.customId.split('_');

    try {
        if (action === 'ban') {
            const [userId] = rest;
            await interaction.deferUpdate();
            await interaction.guild.members.ban(userId, { reason: `スパム対応・BAN（実行者: ${interaction.user.tag}）` });
            await finalizeAlert(interaction, `🔨 <@${userId}> をBANしました（実行者: <@${interaction.user.id}>）`);
            return true;
        }

        if (action === 'release') {
            const [userId] = rest;
            await interaction.deferUpdate();
            const member = await interaction.guild.members.fetch(userId).catch(() => null);
            if (member?.moderatable) {
                await member.timeout(null, `タイムアウト解除（実行者: ${interaction.user.tag}）`);
            }
            await finalizeAlert(interaction, `✅ <@${userId}> のタイムアウトを解除しました（実行者: <@${interaction.user.id}>）`);
            return true;
        }

        if (action === 'delban') {
            const [channelId, userId] = rest;
            await interaction.deferUpdate();
            const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
            if (channel?.isTextBased()) {
                const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
                const targets = recent?.filter(m => m.author.id === userId);
                if (targets?.size) await channel.bulkDelete(targets, true).catch(() => {});
            }
            await interaction.guild.members.ban(userId, { reason: `スパム対応・メッセージ削除&BAN（実行者: ${interaction.user.tag}）` });
            await finalizeAlert(interaction, `🗑️🔨 <@${userId}> のメッセージを削除しBANしました（実行者: <@${interaction.user.id}>）`);
            return true;
        }
    } catch (e) {
        console.error('[SpamEnforcer] ボタン処理エラー:', e.message);
        const fail = { content: `❌ 処理に失敗しました: ${e.message}`, ephemeral: true };
        if (interaction.deferred || interaction.replied) await interaction.followUp(fail).catch(() => {});
        else await interaction.reply(fail).catch(() => {});
    }
    return true;
}

// メッセージ送信者のスパム違反を1件記録し、頻度に応じて処罰する
async function enforce(message, category) {
    try {
        if (!message.guild || message.author.bot) return;

        const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
        if (isExempt(member)) return;

        const count      = bumpStrike(message.author.id);
        const tierIndex  = Math.min(count - 1, ESCALATION.length - 1);
        const action     = ESCALATION[tierIndex];

        console.warn(`[SpamEnforcer] ${message.author.tag}(${message.author.id}) 違反${count}回目 category=${category} action=${action ?? 'none'}`);

        if (action !== null && member) {
            const reason = `スパム頻発（${category}, ${count}回目）`;
            if (action === 'kick') {
                if (member.kickable) {
                    await member.kick(reason).catch(e => console.error('[SpamEnforcer] キック失敗:', e.message));
                }
            } else if (member.moderatable) {
                await member.timeout(action * 60 * 1000, reason).catch(e => console.error('[SpamEnforcer] タイムアウト失敗:', e.message));
                postInteractiveAlert(message, action).catch(e => console.error('[SpamEnforcer] アラートエラー:', e));
            }
        }

        await postLog(message, count, action, category);
    } catch (e) {
        console.error('[SpamEnforcer] 処理エラー:', e);
    }
}

module.exports = { enforce, checkFloodSpam, getStrikeCount, resetStrikes, handleSpamEnforcerButton };
