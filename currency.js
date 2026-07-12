// currency.js — 月間XPに応じた通貨（コイン）配布
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const CURRENCY_FILE    = resolveDataPath('currency.json');
const COIN_NAME         = 'コイン';
const XP_TO_COIN_RATE   = 0.1; // 10XPにつき1コイン

ensureDir(CURRENCY_FILE);

// { userId: balance }
let store = readJson(CURRENCY_FILE, {});

let saveTimer = null;
function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { writeJson(CURRENCY_FILE, store); saveTimer = null; }, 30_000);
}
function saveNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    writeJson(CURRENCY_FILE, store);
}

function getBalance(userId) {
    return store[userId] ?? 0;
}

function addBalance(userId, amount, immediate = false) {
    store[userId] = Math.max(0, (store[userId] ?? 0) + amount);
    if (immediate) saveNow(); else scheduleSave();
    return store[userId];
}

function xpToCoins(xp) {
    return Math.floor(xp * XP_TO_COIN_RATE);
}

// 月間XPランキング（{ id, periodXp, ... }[]）を元にコインを配布
function distributeMonthlyCoins(monthlyBoard) {
    const results = [];
    for (const entry of monthlyBoard) {
        const coins = xpToCoins(entry.periodXp);
        if (coins <= 0) continue;
        const balance = addBalance(entry.id, coins, true);
        results.push({ id: entry.id, coins, balance });
    }
    return results;
}

module.exports = {
    COIN_NAME, XP_TO_COIN_RATE,
    getBalance, addBalance, xpToCoins, distributeMonthlyCoins,
};
