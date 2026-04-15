// activity_tracker.js — メンバーの最終活動時刻を追跡
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const ACTIVITY_FILE = resolveDataPath('activity.json');
ensureDir(ACTIVITY_FILE);

let activity = readJson(ACTIVITY_FILE, {});

// 書き込みを30秒デバウンス（全メッセージでファイルIOしない）
let saveTimer = null;
function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        writeJson(ACTIVITY_FILE, activity);
        saveTimer = null;
    }, 30_000);
}

function recordActivity(userId) {
    activity[userId] = Date.now();
    scheduleSave();
}

function getLastActivity(userId) {
    return activity[userId] ?? null;
}

/**
 * 起動時補完: 活動記録がないメンバーの最終発言をチャンネル履歴から探す
 * 各テキストチャンネルの直近100件を走査してactivityを埋める
 */
async function backfillActivity(guild) {
    const { ChannelType, PermissionFlagsBits } = require('discord.js');
    const textChannels = [...guild.channels.cache.values()].filter(c =>
        c.type === ChannelType.GuildText &&
        c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.ReadMessageHistory)
    );

    for (const ch of textChannels) {
        try {
            const messages = await ch.messages.fetch({ limit: 100 });
            for (const msg of messages.values()) {
                if (msg.author.bot) continue;
                const ts = msg.createdTimestamp;
                if (!activity[msg.author.id] || activity[msg.author.id] < ts) {
                    activity[msg.author.id] = ts;
                }
            }
        } catch { /* 権限なし等はスキップ */ }
    }
    writeJson(ACTIVITY_FILE, activity);
    console.log(`[Activity] バックフィル完了: ${Object.keys(activity).length}名分`);
}

module.exports = { recordActivity, getLastActivity, backfillActivity };
