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

module.exports = { recordActivity, getLastActivity };
