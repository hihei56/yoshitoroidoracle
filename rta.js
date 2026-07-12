// rta.js — 1day-RTA: 日付変更(JST 0時)後に指定チャンネルへ最速で書き込んだ人を表彰
const { EmbedBuilder } = require('discord.js');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');
const { getSettings } = require('./config');

const RECORD_PATH = resolveDataPath('rta_record.json');
ensureDir(RECORD_PATH);

const WEBHOOK_NAME = '1day-RTA';
const EMBED_COLOR  = 0xEB459E;

let record = readJson(RECORD_PATH, {
    bestTimeMs:    null,
    bestHolderId:  null,
    bestDate:      null,
    raceDayStart:  null,
    todayWinnerId: null,
    todayTimeMs:   null,
});

function save() {
    writeJson(RECORD_PATH, record);
}

// 指定時刻(ms)が属するJSTカレンダー日の 00:00:00 を UTCエポック(ms)で返す（JSTはDSTなしのUTC+9固定）
function jstMidnight(atMs) {
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' })
        .format(new Date(atMs))
        .split('-')
        .map(Number);
    return Date.UTC(y, m - 1, d) - 9 * 60 * 60 * 1000;
}

function jstDateString(atMs) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date(atMs));
}

function formatSeconds(ms) {
    return `${(ms / 1000).toFixed(3)}秒`;
}

const webhookCache = new Map();

async function getWebhook(channel, client) {
    if (webhookCache.has(channel.id)) return webhookCache.get(channel.id);
    const hooks = await channel.fetchWebhooks();
    let wh = hooks.find(h => h.owner?.id === client.user.id && h.token);
    if (!wh) wh = await channel.createWebhook({ name: WEBHOOK_NAME, avatar: client.user.displayAvatarURL() });
    webhookCache.set(channel.id, wh);
    return wh;
}

async function postResult(message) {
    const embed = new EmbedBuilder()
        .setTitle('1day-RTA')
        .setColor(EMBED_COLOR)
        .setThumbnail(message.client.user.displayAvatarURL())
        .addFields(
            { name: '今日のタイム', value: formatSeconds(record.todayTimeMs), inline: true },
            { name: '過去最高速度', value: record.bestTimeMs !== null ? formatSeconds(record.bestTimeMs) : '記録なし', inline: true },
        )
        .setDescription(`最速だった <@${record.todayWinnerId}> さん、\nおめでとうございます！\n次回は1日後に開催されます！`)
        .setTimestamp();

    try {
        const wh = await getWebhook(message.channel, message.client);
        await wh.send({
            embeds:          [embed],
            username:        WEBHOOK_NAME,
            avatarURL:       message.client.user.displayAvatarURL(),
            allowedMentions: { parse: ['users'] },
        });
    } catch (e) {
        console.error('[RTA] Webhook送信失敗:', e.message);
        await message.channel.send({ embeds: [embed] }).catch(() => {});
    }
}

async function handleRtaMessage(message) {
    try {
        if (message.author.bot || !message.guild) return;

        const settings = getSettings();
        if (!settings.rtaChannelId || message.channelId !== settings.rtaChannelId) return;

        const dayStart = jstMidnight(message.createdTimestamp);

        if (record.raceDayStart !== dayStart) {
            record.raceDayStart  = dayStart;
            record.todayWinnerId = null;
            record.todayTimeMs   = null;
        }

        if (record.todayWinnerId) return; // 本日分は決着済み

        const elapsed = message.createdTimestamp - dayStart;
        record.todayWinnerId = message.author.id;
        record.todayTimeMs   = elapsed;

        if (record.bestTimeMs === null || elapsed < record.bestTimeMs) {
            record.bestTimeMs   = elapsed;
            record.bestHolderId = message.author.id;
            record.bestDate     = jstDateString(message.createdTimestamp);
        }

        save();
        console.info(`[RTA] ${message.author.tag} が本日の1day-RTAを制覇: ${formatSeconds(elapsed)}`);
        await postResult(message);
    } catch (e) {
        console.error('[RTA] 処理エラー:', e);
    }
}

function resetRtaRace() {
    record.raceDayStart  = null;
    record.todayWinnerId = null;
    record.todayTimeMs   = null;
    save();
}

module.exports = { handleRtaMessage, resetRtaRace };
