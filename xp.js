// xp.js — 経験値・レベルシステム
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const XP_FILE      = resolveDataPath('xp.json');
const XP_PER_LEVEL = 70;

ensureDir(XP_FILE);

// { userId: { xp, level, levelBase }, _excludedRoles: [...], _aliases: { userId: '通称' } }
let store = readJson(XP_FILE, {});
if (!Array.isArray(store._excludedRoles)) store._excludedRoles = [];
if (!store._aliases || typeof store._aliases !== 'object') store._aliases = {};

const lastMsgTime = {};

let saveTimer = null;
function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { writeJson(XP_FILE, store); saveTimer = null; }, 30_000);
}
function saveNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    writeJson(XP_FILE, store);
}

// ── JST日付ユーティリティ ─────────────────────────────────────────────
function jstDateStr(offsetDays = 0) {
    const d = new Date(Date.now() + (9 * 60 + offsetDays * 24 * 60) * 60 * 1000);
    return d.toISOString().slice(0, 10);
}

function jstWeekDates() {
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const day = now.getDay(); // 0=Sun
    const diffToMon = day === 0 ? -6 : 1 - day;
    const dates = [];
    for (let i = diffToMon; i <= 0; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() + i);
        dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
}

function jstMonthPrefix() {
    return store._monthOverride ?? jstDateStr().slice(0, 7);
}

function setMonthOverride(ym) {
    if (ym) store._monthOverride = ym;
    else delete store._monthOverride;
    saveNow();
}

function getMonthOverride() {
    return store._monthOverride ?? null;
}

function entry(userId) {
    if (!store[userId]) store[userId] = { xp: 0, level: 0, levelBase: 0 };
    // 旧データ（levelBaseなし）の移行
    if (store[userId].levelBase === undefined) store[userId].levelBase = store[userId].xp;
    if (!store[userId].history) store[userId].history = {};
    return store[userId];
}

// ── 4パラメータ ──────────────────────────────────────────────────────

function lengthFactor(content) {
    const len = [...content].length;
    if (len < 5)   return 0.5;
    if (len < 15)  return 1.0;
    if (len < 40)  return 1.5;
    if (len < 100) return 2.0;
    return 2.5;
}

function diversityFactor(content) {
    const chars = [...content].filter(c => c.trim());
    if (!chars.length) return 0.5;
    const ratio = new Set(chars).size / chars.length;
    if (ratio < 0.25) return 0.4;
    if (ratio < 0.45) return 0.7;
    if (ratio < 0.65) return 1.0;
    return 1.2;
}

function intervalFactor(userId, now) {
    const sec = (now - (lastMsgTime[userId] ?? 0)) / 1000;
    if (sec < 5)   return 0;
    if (sec < 30)  return 0.4;
    if (sec < 120) return 0.8;
    if (sec < 600) return 1.2;
    return 1.5;
}

function contentFactor(content) {
    let f = 1.0;
    if (/https?:\/\/\S+/.test(content))         f += 0.25;
    if (/<@!?\d+>/.test(content))                f += 0.15;
    if (/[？?！!。、…]/.test(content))           f += 0.10;
    if (/<a?:\w+:\d+>/.test(content) ||
        /\p{Emoji_Presentation}/u.test(content)) f += 0.10;
    return Math.min(f, 1.5);
}

// ── コア ─────────────────────────────────────────────────────────────

function processMessage(userId, content, now = Date.now()) {
    const gained = parseFloat((
        lengthFactor(content) * diversityFactor(content) *
        intervalFactor(userId, now) * contentFactor(content)
    ).toFixed(2));

    lastMsgTime[userId] = now;

    const u = entry(userId);
    u.xp += gained;

    // 履歴記録（JST日付）
    const today = jstDateStr();
    u.history[today] = parseFloat(((u.history[today] ?? 0) + gained).toFixed(2));
    // 90日より古いエントリを削除
    const cutoff = jstDateStr(-90);
    for (const d of Object.keys(u.history)) { if (d < cutoff) delete u.history[d]; }

    let newLevel = null;
    while (u.xp - u.levelBase >= XP_PER_LEVEL) {
        u.level++;
        u.levelBase += XP_PER_LEVEL;
        newLevel = u.level;
    }

    scheduleSave();
    return { gained, xp: u.xp, level: u.level, newLevel };
}

function getUserData(userId) {
    const d = store[userId];
    if (!d) return { xp: 0, level: 0, levelBase: 0 };
    return { ...d, levelBase: d.levelBase ?? d.xp };
}

function getRank(userId) {
    const sorted = Object.entries(store)
        .filter(([k]) => !k.startsWith('_'))
        .sort(([, a], [, b]) => b.xp - a.xp);
    const idx = sorted.findIndex(([id]) => id === userId);
    return idx === -1 ? null : idx + 1;
}

function getLeaderboard(n = 10) {
    return Object.entries(store)
        .filter(([k]) => !k.startsWith('_'))
        .map(([id, d]) => ({ id, ...d }))
        .sort((a, b) => b.xp - a.xp)
        .slice(0, n);
}

function getPeriodXp(userId, period) {
    const history = store[userId]?.history ?? {};
    if (period === 'day') {
        return history[jstDateStr()] ?? 0;
    }
    if (period === 'week') {
        return jstWeekDates().reduce((s, d) => s + (history[d] ?? 0), 0);
    }
    if (period === 'month') {
        const prefix = jstMonthPrefix();
        return Object.entries(history)
            .filter(([d]) => d.startsWith(prefix))
            .reduce((s, [, v]) => s + v, 0);
    }
    return store[userId]?.xp ?? 0;
}

function getLeaderboardByPeriod(period, n = 10) {
    return Object.keys(store)
        .filter(k => !k.startsWith('_'))
        .map(id => ({ id, periodXp: getPeriodXp(id, period), ...store[id] }))
        .filter(e => e.periodXp > 0)
        .sort((a, b) => b.periodXp - a.periodXp)
        .slice(0, n);
}

function xpToNextLevel(data) {
    const base = data.levelBase ?? data.xp;
    return XP_PER_LEVEL - (data.xp - base);
}

// ── 管理 ─────────────────────────────────────────────────────────────

function setUserLevel(userId, level, xp = null) {
    const u = entry(userId);
    u.level     = level;
    u.xp        = xp ?? u.xp;
    u.levelBase = u.xp;
    saveNow();
    return u;
}

function adjustXP(userId, amount) {
    const u = entry(userId);
    u.xp = Math.max(u.levelBase, u.xp + amount);
    // 減算でレベル割り込む場合はlevelBaseを再調整
    if (u.xp < u.levelBase) { u.levelBase = u.xp; }
    // 加算でレベルアップ
    while (u.xp - u.levelBase >= XP_PER_LEVEL) {
        u.level++;
        u.levelBase += XP_PER_LEVEL;
    }
    saveNow();
    return u;
}

function resetUser(userId) {
    store[userId] = { xp: 0, level: 0, levelBase: 0 };
    saveNow();
}

function setHideBadge(userId, hide) {
    entry(userId).hideBadge = hide;
    saveNow();
}

function isHideBadge(userId) {
    return store[userId]?.hideBadge === true;
}

// ── 除外ロール ────────────────────────────────────────────────────────

function addExcludedRole(roleId) {
    if (!store._excludedRoles.includes(roleId)) {
        store._excludedRoles.push(roleId);
        saveNow();
    }
}

function removeExcludedRole(roleId) {
    store._excludedRoles = store._excludedRoles.filter(id => id !== roleId);
    saveNow();
}

function getExcludedRoles() { return [...store._excludedRoles]; }

function isExcluded(member) {
    return store._excludedRoles.some(id => member?.roles?.cache?.has(id));
}

// ── バッジ ────────────────────────────────────────────────────────────

const LEVEL_BADGES = [
    { min: 30, emoji: '👑', color: 0xf5a623 },
    { min: 20, emoji: '💎', color: 0x00d4ff },
    { min: 10, emoji: '⚡', color: 0xb026ff },
    { min: 5,  emoji: '🔥', color: 0xff4500 },
    { min: 0,  emoji: '🌱', color: 0x57f287 },
];

function getLevelBadge(level) {
    return LEVEL_BADGES.find(b => level >= b.min) ?? LEVEL_BADGES.at(-1);
}

function setAlias(userId, alias) {
    if (alias) store._aliases[userId] = alias;
    else delete store._aliases[userId];
    saveNow();
}

function getAlias(userId) {
    return store._aliases[userId] ?? null;
}

function getMonthlyRank(userId) {
    const board = getLeaderboardByPeriod('month', 9999);
    const idx   = board.findIndex(e => e.id === userId);
    return idx === -1 ? null : idx + 1;
}

const NICK_STRIP = /\s*[🌱🔥⚡💎👑]#?\d+$/;

function buildNickname(baseNick, level, monthRank = null) {
    const { emoji } = getLevelBadge(level);
    const stripped  = baseNick.replace(NICK_STRIP, '');
    const rankStr   = monthRank != null ? `#${monthRank}` : '#?';
    return `${stripped} ${emoji}${rankStr}`.slice(0, 32);
}

module.exports = {
    XP_PER_LEVEL,
    processMessage, getUserData, getRank, getLeaderboard, xpToNextLevel,
    getPeriodXp, getLeaderboardByPeriod,
    setUserLevel, adjustXP, resetUser,
    setHideBadge, isHideBadge,
    addExcludedRole, removeExcludedRole, getExcludedRoles, isExcluded,
    buildNickname, getLevelBadge, getMonthlyRank,
    setAlias, getAlias,
    setMonthOverride, getMonthOverride,
};
