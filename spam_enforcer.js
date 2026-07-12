// spam_enforcer.js — 頻発スパムユーザーへの累進処罰（削除→タイムアウト延長→キック）
const { EmbedBuilder } = require('discord.js');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');
const { getModExcludeList } = require('./exclude_manager');

const STRIKES_PATH = resolveDataPath('spam_strikes.json');
ensureDir(STRIKES_PATH);

const LOG_CHANNEL_ID = process.env.SPAM_LOG_CHANNEL_ID || '1476943641242239056';

// この期間内の違反のみ「頻発」として積み上げる。期間を過ぎたら初犯扱いにリセット
const STRIKE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3日

// 累積違反回数 → 処罰（分単位のタイムアウト、または 'kick'）。1回目は削除のみ
const ESCALATION = [null, 10, 60, 360, 1440, 40320, 'kick'];

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
            }
        }

        await postLog(message, count, action, category);
    } catch (e) {
        console.error('[SpamEnforcer] 処理エラー:', e);
    }
}

module.exports = { enforce, getStrikeCount, resetStrikes };
