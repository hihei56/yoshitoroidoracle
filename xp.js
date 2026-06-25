// xp.js — 経験値・レベルシステム
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const XP_FILE     = resolveDataPath('xp.json');
const XP_PER_LEVEL = 70;

ensureDir(XP_FILE);

// { userId: { xp, level }, _excludedRoles: [...] }
let store = readJson(XP_FILE, {});
if (!Array.isArray(store._excludedRoles)) store._excludedRoles = [];

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

function entry(userId) {
    if (!store[userId]) store[userId] = { xp: 0, level: 0 };
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
    if (/https?:\/\/\S+/.test(content))        f += 0.25;
    if (/<@!?\d+>/.test(content))               f += 0.15;
    if (/[？?！!。、…]/.test(content))          f += 0.10;
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

    let newLevel = null;
    while (u.xp >= (u.level + 1) * XP_PER_LEVEL) {
        u.level++;
        newLevel = u.level;
    }

    scheduleSave();
    return { gained, xp: u.xp, level: u.level, newLevel };
}

function getUserData(userId) {
    return store[userId] ?? { xp: 0, level: 0 };
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

function xpToNextLevel(data) {
    return (data.level + 1) * XP_PER_LEVEL - data.xp;
}

// ── 管理 ─────────────────────────────────────────────────────────────

function setUserLevel(userId, level) {
    const u = entry(userId);
    u.level = level;
    u.xp    = level * XP_PER_LEVEL;
    saveNow();
    return u;
}

function adjustXP(userId, amount) {
    const u = entry(userId);
    u.xp    = Math.max(0, u.xp + amount);
    u.level = Math.floor(u.xp / XP_PER_LEVEL);
    saveNow();
    return u;
}

function resetUser(userId) {
    store[userId] = { xp: 0, level: 0 };
    saveNow();
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

function buildNickname(baseNick, level) {
    const { emoji } = getLevelBadge(level);
    const stripped  = baseNick.replace(/\s*[🌱🔥⚡💎👑]\d+$/, '');
    return `${stripped} ${emoji}${level}`.slice(0, 32);
}

module.exports = {
    XP_PER_LEVEL,
    processMessage, getUserData, getRank, getLeaderboard, xpToNextLevel,
    setUserLevel, adjustXP, resetUser,
    addExcludedRole, removeExcludedRole, getExcludedRoles, isExcluded,
    buildNickname, getLevelBadge,
};
