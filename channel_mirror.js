// channel_mirror.js — 特定チャンネルの投稿を別チャンネルへ複製転送
// テキストはそのままコピー、添付メディアは事前にDLして再アップロード（元URL失効に備えたCDN保存）
// 複数投稿・複数宛先へは間隔を空けて順次送信し、スパム扱いされないようにする
const axios = require('axios');
const whStore = require('./webhook_store');
const { getSettings } = require('./config');

const QUEUE_INTERVAL_MS  = 4000; // 連投時、次のメッセージ転送までの間隔
const TARGET_INTERVAL_MS = 1200; // 複数宛先へ投稿する際、次の宛先までの間隔
const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;

const webhookCache = new Map();

async function getOrCreateWebhook(channel) {
    const target = channel.isThread() ? channel.parent : channel;
    if (!target) return null;
    const key = target.id;

    if (webhookCache.has(key)) return webhookCache.get(key);

    const stored = whStore.get(key);
    if (stored) {
        webhookCache.set(key, stored);
        return stored;
    }
    try {
        const hooks = await target.fetchWebhooks();
        let wh = hooks.find(h => h.token);
        if (!wh) wh = await target.createWebhook({ name: 'ChannelMirror' });
        whStore.set(key, wh);
        webhookCache.set(key, wh);
        return wh;
    } catch (e) {
        console.error(`[ChannelMirror] Webhook取得失敗 (${key}):`, e.message);
        return null;
    }
}

async function downloadAttachment(att) {
    try {
        const res = await axios.get(att.url, { responseType: 'arraybuffer', timeout: 15000 });
        if (res.data.byteLength > MAX_ATTACHMENT_SIZE) {
            console.warn(`[ChannelMirror] 添付サイズ超過スキップ: ${att.name} (${res.data.byteLength}bytes)`);
            return null;
        }
        return { attachment: Buffer.from(res.data), name: att.name || 'file' };
    } catch (e) {
        console.warn(`[ChannelMirror] 添付DL失敗 (${att.url}):`, e.message);
        return null;
    }
}

// ===== 転送キュー（連投時は間隔を空けて順次処理） =====
const queue = [];
let processing = false;

function enqueue(job) {
    queue.push(job);
    processQueue();
}

async function processQueue() {
    if (processing) return;
    processing = true;
    while (queue.length) {
        const job = queue.shift();
        await job().catch(e => console.error('[ChannelMirror] 転送処理エラー:', e.message));
        if (queue.length) await new Promise(r => setTimeout(r, QUEUE_INTERVAL_MS));
    }
    processing = false;
}

async function mirrorMessage(message, client) {
    const settings  = getSettings();
    const targetIds = settings.mirrorTargetChannelIds ?? [];
    if (!targetIds.length) return;

    const files = [];
    for (const att of message.attachments.values()) {
        const file = await downloadAttachment(att);
        if (file) files.push(file);
    }

    const username  = message.member?.displayName ?? message.author.username;
    const avatarURL = message.member?.displayAvatarURL({ dynamic: true }) ?? message.author.displayAvatarURL({ dynamic: true });

    for (let i = 0; i < targetIds.length; i++) {
        const targetId = targetIds[i];
        if (targetId === message.channelId) continue;

        try {
            const channel = await client.channels.fetch(targetId).catch(() => null);
            if (!channel) {
                console.warn(`[ChannelMirror] 送信先チャンネル取得失敗: ${targetId}`);
                continue;
            }

            const payload = {
                content: message.content || undefined,
                files,
                allowedMentions: { parse: [] },
            };

            const webhook = await getOrCreateWebhook(channel);
            if (webhook) {
                await webhook.send({ ...payload, username, avatarURL });
            } else {
                await channel.send(payload);
            }
        } catch (e) {
            console.error(`[ChannelMirror] 転送失敗 → ${targetId}:`, e.message);
        }

        if (i < targetIds.length - 1) await new Promise(r => setTimeout(r, TARGET_INTERVAL_MS));
    }
}

function handleChannelMirror(message, client) {
    if (!message.guild) return;
    const settings = getSettings();
    if (!settings.mirrorSourceChannelId) return;
    if (message.channelId !== settings.mirrorSourceChannelId) return;
    if (!message.content && message.attachments.size === 0) return;

    enqueue(() => mirrorMessage(message, client));
}

module.exports = { handleChannelMirror };
