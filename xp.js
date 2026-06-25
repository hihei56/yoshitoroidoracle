// xp.js — 経験値・レベルシステム
// 4つの内部パラメータ（文字数/多様性/間隔/内容）でXPを動的計算
// ファーミング耐性付き、70XPごとにレベルアップ
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const XP_FILE     = resolveDataPath('xp.json');
const XP_PER_LEVEL = 70;

ensureDir(XP_FILE);

// { userId: { xp: number, level: number } }
let xpData = readJson(XP_FILE, {});

// メモリ上で最終発言時刻を管理（永続化不要）
const lastMsgTime = {};

let saveTimer = null;
function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        writeJson(XP_FILE, xpData);
        saveTimer = null;
    }, 30_000);
}

// ── パラメータ1: 文字数係数 ──────────────────────────────────────
function lengthFactor(content) {
    const len = [...content].length; // Unicode対応
    if (len < 5)   return 0.5;
    if (len < 15)  return 1.0;
    if (len < 40)  return 1.5;
    if (len < 100) return 2.0;
    return 2.5;
}

// ── パラメータ2: 多様性係数（文字の多様性でスパム抑制）────────────
function diversityFactor(content) {
    const chars = [...content].filter(c => c.trim()); // 空白除外
    if (chars.length === 0) return 0.5;
    const unique = new Set(chars).size;
    const ratio  = unique / chars.length;
    if (ratio < 0.25) return 0.4;
    if (ratio < 0.45) return 0.7;
    if (ratio < 0.65) return 1.0;
    return 1.2;
}

// ── パラメータ3: 間隔係数（連投ファーミング対策）──────────────────
function intervalFactor(userId, now) {
    const last = lastMsgTime[userId] ?? 0;
    const sec  = (now - last) / 1000;
    if (sec < 5)   return 0;
    if (sec < 30)  return 0.4;
    if (sec < 120) return 0.8;
    if (sec < 600) return 1.2;
    return 1.5;
}

// ── パラメータ4: 内容係数（URL/メンション/質問/絵文字でボーナス）──
function contentFactor(content) {
    let f = 1.0;
    if (/https?:\/\/\S+/.test(content))          f += 0.25;
    if (/<@!?\d+>/.test(content))                 f += 0.15;
    if (/[？?！!。、…]{1}/.test(content))         f += 0.10;
    if (/<a?:\w+:\d+>/.test(content) ||
        /\p{Emoji_Presentation}/u.test(content))  f += 0.10;
    return Math.min(f, 1.5);
}

/**
 * メッセージからXPを計算して付与。
 * @returns {{ gained: number, before: number, after: number, newLevel: number|null }}
 */
function processMessage(userId, content, now = Date.now()) {
    const l = lengthFactor(content);
    const d = diversityFactor(content);
    const i = intervalFactor(userId, now);
    const c = contentFactor(content);
    const gained = parseFloat((l * d * i * c).toFixed(2));

    lastMsgTime[userId] = now;

    if (!xpData[userId]) xpData[userId] = { xp: 0, level: 0 };
    const before     = xpData[userId].xp;
    const beforeLv   = xpData[userId].level;
    xpData[userId].xp += gained;

    // レベルアップ判定
    let newLevel = null;
    while (xpData[userId].xp >= (xpData[userId].level + 1) * XP_PER_LEVEL) {
        xpData[userId].level++;
        newLevel = xpData[userId].level;
    }

    scheduleSave();
    return { gained, before, after: xpData[userId].xp, level: xpData[userId].level, newLevel };
}

function getUserData(userId) {
    return xpData[userId] ?? { xp: 0, level: 0 };
}

/** XPランキング上位n件を返す */
function getLeaderboard(n = 10) {
    return Object.entries(xpData)
        .map(([id, d]) => ({ id, ...d }))
        .sort((a, b) => b.xp - a.xp)
        .slice(0, n);
}

/** 次のレベルまでに必要なXP */
function xpToNextLevel(userData) {
    return (userData.level + 1) * XP_PER_LEVEL - userData.xp;
}

const LEVEL_BADGES = [
    { min: 30, emoji: '👑' },
    { min: 20, emoji: '💎' },
    { min: 10, emoji: '⚡' },
    { min: 5,  emoji: '🔥' },
    { min: 0,  emoji: '🌱' },
];

function getLevelBadge(level) {
    return (LEVEL_BADGES.find(b => level >= b.min) ?? LEVEL_BADGES.at(-1)).emoji;
}

/** ニックネームにレベルバッジを付与（末尾）した文字列を返す */
function buildNickname(baseNick, level) {
    const badge   = getLevelBadge(level);
    const stripped = baseNick.replace(/\s*[🌱🔥⚡💎👑]\d+$/, '');
    const result   = `${stripped} ${badge}${level}`;
    return result.slice(0, 32); // Discordのnick上限
}

module.exports = { processMessage, getUserData, getLeaderboard, xpToNextLevel, XP_PER_LEVEL, buildNickname };
