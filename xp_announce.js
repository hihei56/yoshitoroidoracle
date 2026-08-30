// xp_announce.js — XPランキングの定期発表（毎日0時: 前日分デイリー / 月末: 月間+コイン配布）
const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const { getLeaderboardByPeriod } = require('./xp');
const { distributeMonthlyCoins, COIN_NAME } = require('./currency');
const { getSettings } = require('./config');

const TOP_N = 5;

// 月末23:55に実行することで、日付が翌月に切り替わる前に「終わる月」のデータを取得する
function isLastDayOfMonthJST() {
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return tomorrow.getMonth() !== now.getMonth();
}

async function fetchTopAvatarUrl(client, userId) {
    if (!userId) return null;
    try {
        const guild  = client.guilds.cache.first();
        const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
        if (member) return member.displayAvatarURL({ size: 128 });
        const user = await client.users.fetch(userId).catch(() => null);
        return user?.displayAvatarURL({ size: 128 }) ?? null;
    } catch {
        return null;
    }
}

function buildRankingEmbed(title, board, color, topAvatarUrl, coinMap = null) {
    const lines = board.length
        ? board.map((e, i) => {
            const base = `**#${i + 1}** <@${e.id}> — ${Math.floor(e.periodXp).toLocaleString('en-US')} XP`;
            return coinMap ? `${base}（+${(coinMap.get(e.id) ?? 0).toLocaleString('en-US')}${COIN_NAME}）` : base;
        })
        : ['まだデータがありません。'];
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(lines.join('\n'))
        .setFooter({ text: coinMap ? `🎁 今月の活動に応じて${COIN_NAME}を配布しました！` : '🎁 上位者には特典があるかも……？' })
        .setTimestamp();
    if (topAvatarUrl) embed.setThumbnail(topAvatarUrl);
    return embed;
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

async function postDailyRanking(client) {
    try {
        const board     = getLeaderboardByPeriod('yesterday', TOP_N);
        const avatarUrl = await fetchTopAvatarUrl(client, board[0]?.id);
        await announce(client, buildRankingEmbed('📆 デイリーXPランキング（前日の結果）', board, 0x57F287, avatarUrl));
    } catch (e) {
        console.error('[XpAnnounce] デイリーランキングエラー:', e.message);
    }
}

async function postMonthlyRanking(client) {
    try {
        const fullBoard = getLeaderboardByPeriod('month', 9999);
        const distributed = distributeMonthlyCoins(fullBoard);
        const coinMap    = new Map(distributed.map(d => [d.id, d.coins]));

        const board     = fullBoard.slice(0, TOP_N);
        const avatarUrl = await fetchTopAvatarUrl(client, board[0]?.id);
        await announce(client, buildRankingEmbed('🏆 月間XPランキング（今月の結果）', board, 0xf5a623, avatarUrl, coinMap));
        console.log(`[XpAnnounce] コイン配布完了: ${distributed.length}名`);
    } catch (e) {
        console.error('[XpAnnounce] 月間ランキングエラー:', e.message);
    }
}

function initXpAnnounce(client) {
    cron.schedule('0 0 * * *', () => postDailyRanking(client), { timezone: 'Asia/Tokyo' });
    cron.schedule('55 23 * * *', () => {
        if (isLastDayOfMonthJST()) postMonthlyRanking(client);
    }, { timezone: 'Asia/Tokyo' });
    console.log('[XpAnnounce] ✅ 初期化 | 毎日0時: デイリー(前日分)ランキング / 月末23:55: 月間ランキング');
}

module.exports = { initXpAnnounce };
