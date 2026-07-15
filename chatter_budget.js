// chatter_budget.js — 雑談chatterのAI生成回数を1日単位（日本時間）で管理し、
// 無料枠を使い切らない範囲でギリギリまで会話量を確保するための予算カウンター
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');
const { getSettings } = require('./config');

const BUDGET_PATH = resolveDataPath('chatter_budget.json');
ensureDir(BUDGET_PATH);

// Groq無料枠（qwen/qwen3-32b等: 目安1,000req/day）に対して余裕を持たせたデフォルト上限
const DEFAULT_DAILY_BUDGET = 700;

function todayJst() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }); // YYYY-MM-DD
}

let cache = readJson(BUDGET_PATH, null);

function load() {
    const today = todayJst();
    if (!cache || cache.date !== today) {
        cache = { date: today, count: 0 };
        writeJson(BUDGET_PATH, cache);
    }
    return cache;
}

function getDailyBudget() {
    const settings = getSettings();
    return settings.chatterDailyBudget || DEFAULT_DAILY_BUDGET;
}

function getUsage() {
    const state = load();
    return { date: state.date, count: state.count, budget: getDailyBudget() };
}

function hasBudget() {
    const state = load();
    return state.count < getDailyBudget();
}

function recordUsage() {
    const state = load();
    state.count += 1;
    writeJson(BUDGET_PATH, state);
    return state.count;
}

module.exports = { getUsage, hasBudget, recordUsage, getDailyBudget, DEFAULT_DAILY_BUDGET };
