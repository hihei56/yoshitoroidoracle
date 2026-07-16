// chatter_budget.js — 雑談chatterのAI生成回数をプロバイダーごと・1日単位（日本時間）で管理し、
// 各プロバイダーの無料枠を使い切らない範囲でギリギリまで会話量を確保するための予算カウンター
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');
const { getSettings } = require('./config');

const BUDGET_PATH = resolveDataPath('chatter_budget.json');
ensureDir(BUDGET_PATH);

// 各プロバイダーの無料枠目安に対して余裕を持たせたデフォルト上限
const DEFAULT_DAILY_BUDGETS = {
    groq: 700,        // 目安1,000req/day（qwen/qwen3-32b等）
    cloudflare: 500,  // Workers AI無料枠の目安
    gemini: 1300,     // 目安1,500req/day（gemini-2.0-flash等）
};

function todayJst() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }); // YYYY-MM-DD
}

let cache = readJson(BUDGET_PATH, null);

function load() {
    const today = todayJst();
    if (!cache || cache.date !== today) {
        cache = { date: today, usage: {} };
        writeJson(BUDGET_PATH, cache);
        return cache;
    }
    if (!cache.usage) {
        // 旧形式（プロバイダー横断の単一カウンタ）からの移行。従来は事実上groq専用だったため引き継ぐ
        cache = { date: cache.date, usage: { groq: cache.count ?? 0 } };
        writeJson(BUDGET_PATH, cache);
    }
    return cache;
}

function getDailyBudget(provider) {
    const settings = getSettings();
    return settings.chatterDailyBudgets?.[provider] ?? DEFAULT_DAILY_BUDGETS[provider] ?? 500;
}

function getUsage(provider) {
    const state = load();
    if (provider) {
        return { date: state.date, count: state.usage[provider] ?? 0, budget: getDailyBudget(provider) };
    }
    const providers = Object.keys(DEFAULT_DAILY_BUDGETS);
    return {
        date: state.date,
        providers: Object.fromEntries(
            providers.map(p => [p, { count: state.usage[p] ?? 0, budget: getDailyBudget(p) }])
        ),
    };
}

function hasBudget(provider) {
    const state = load();
    return (state.usage[provider] ?? 0) < getDailyBudget(provider);
}

function recordUsage(provider) {
    const state = load();
    state.usage[provider] = (state.usage[provider] ?? 0) + 1;
    writeJson(BUDGET_PATH, state);
    return state.usage[provider];
}

module.exports = { getUsage, hasBudget, recordUsage, getDailyBudget, DEFAULT_DAILY_BUDGETS };
