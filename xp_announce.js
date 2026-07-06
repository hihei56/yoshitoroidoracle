// xp_announce.js — XPランキングの定期発表（毎日0時: 週間 / 月末: 月間）
const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const { getLeaderboardByPeriod } = require('./xp');
const { getSettings } = require('./config');

const TOP_N = 5;

// 月末23:55に実行することで、日付が翌月に切り替わる前に「終わる月」のデータを取得する
function isLastDayOfMonthJST() {
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return tomorrow.getMonth() !== now.getMonth();
}

function buildRankingEmbed(title, board, color) {
    const lines = board.length
        ? board.map((e, i) => `**#${i + 1}** <@${e.id}> — ${Math.floor(e.periodXp).toLocaleString('en-US')} XP`)
        : ['まだデータがありません。'];
    return new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(lines.join('\n'))
        .setFooter({ text: '🎁 上位者には特典があるかも……？' })
        .setTimestamp();
}

async function announce(client, embed) {
    const settings  = getSettings();
    const channelId = settings.rankingChannelId;
    if (!channelId) return;
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return;
        await channel.send({ embeds: [embed] });
    } catch (e) {
        console.error('[XpAnnounce] 送信エラー:', e.message);
    }
}

async function postWeeklyRanking(client) {
    try {
        const board = getLeaderboardByPeriod('week', TOP_N);
        await announce(client, buildRankingEmbed('📅 週間XPランキング', board, 0x5865F2));
    } catch (e) {
        console.error('[XpAnnounce] 週間ランキングエラー:', e.message);
    }
}

async function postMonthlyRanking(client) {
    try {
        const board = getLeaderboardByPeriod('month', TOP_N);
        await announce(client, buildRankingEmbed('🏆 月間XPランキング（今月の結果）', board, 0xf5a623));
    } catch (e) {
        console.error('[XpAnnounce] 月間ランキングエラー:', e.message);
    }
}

function initXpAnnounce(client) {
    cron.schedule('0 0 * * *', () => postWeeklyRanking(client), { timezone: 'Asia/Tokyo' });
    cron.schedule('55 23 * * *', () => {
        if (isLastDayOfMonthJST()) postMonthlyRanking(client);
    }, { timezone: 'Asia/Tokyo' });
    console.log('[XpAnnounce] ✅ 初期化 | 毎日0時: 週間ランキング / 月末23:55: 月間ランキング');
}

module.exports = { initXpAnnounce };
