// say_sessions.js — /say の24時間セッション管理
// 1アカウントにつき24時間有効な「名前 + 4桁ID」を割り当てる
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const SESSIONS_FILE  = resolveDataPath('say_sessions.json');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24時間

ensureDir(SESSIONS_FILE);

let sessions = readJson(SESSIONS_FILE, {});

// 期限切れエントリを掃除してファイルに保存
function persist() {
    const now = Date.now();
    for (const uid of Object.keys(sessions)) {
        if (sessions[uid].expiresAt <= now) delete sessions[uid];
    }
    writeJson(SESSIONS_FILE, sessions);
}

/** 有効なセッションを返す。期限切れ/未存在なら null */
function getSession(userId) {
    const s = sessions[userId];
    return (s && s.expiresAt > Date.now()) ? s : null;
}

/** 新セッションを生成・保存して返す */
function createSession(userId, name) {
    const sessionId = String(Math.floor(Math.random() * 9000) + 1000); // 1000〜9999
    sessions[userId] = {
        name,
        sessionId,
        expiresAt: Date.now() + SESSION_TTL_MS,
    };
    persist();
    return sessions[userId];
}

module.exports = { getSession, createSession };
