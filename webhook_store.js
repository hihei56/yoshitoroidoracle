// webhook_store.js — Webhookトークンの永続化
// チャンネルIDをキーに { id, token } をファイルに保存し、
// bot再起動後もfetchWebhooks()不要でWebhookClientを即座に復元できる
const { WebhookClient } = require('discord.js');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const STORE_FILE = resolveDataPath('webhooks.json');
ensureDir(STORE_FILE);

// { channelId: { id: "...", token: "..." } }
let store = readJson(STORE_FILE, {});

function get(channelId) {
    const s = store[channelId];
    return s ? new WebhookClient({ id: s.id, token: s.token }) : null;
}

function set(channelId, webhook) {
    if (!webhook?.token) return;
    store[channelId] = { id: webhook.id, token: webhook.token };
    writeJson(STORE_FILE, store);
}

function remove(channelId) {
    if (!store[channelId]) return;
    delete store[channelId];
    writeJson(STORE_FILE, store);
}

module.exports = { get, set, remove };
