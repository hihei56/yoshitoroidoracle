// medialink_manager.js — メディアリンクBAN管理（チャンネル指定対応）
// データ形式: { [userId]: null | string[] }
//   null      → 全チャンネルでBAN
//   string[]  → 指定チャンネルのみBAN
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const MEDIALINK_FILE = resolveDataPath('medialink_banned_users.json');
ensureDir(MEDIALINK_FILE);

// { userId: null | channelId[] }
let bannedMap = new Map(Object.entries(readJson(MEDIALINK_FILE, {})));

function save() {
    writeJson(MEDIALINK_FILE, Object.fromEntries(bannedMap));
}

// channelId=null → 全チャンネルBAN、指定時 → そのチャンネルを追加
function addMediaLinkBan(userId, channelId = null) {
    if (channelId === null) {
        bannedMap.set(userId, null);
    } else {
        const current = bannedMap.get(userId);
        if (current === null) return; // 既に全チャンネルBAN済み
        const channels = current ?? [];
        if (!channels.includes(channelId)) channels.push(channelId);
        bannedMap.set(userId, channels);
    }
    save();
}

// channelId=null → 全BANを解除、指定時 → そのチャンネルのみ解除
function removeMediaLinkBan(userId, channelId = null) {
    if (channelId === null) {
        bannedMap.delete(userId);
    } else {
        const current = bannedMap.get(userId);
        if (!current) return;
        if (current === null) {
            // 全チャンネルBAN → 指定チャンネルだけ外す（他は全チャンネルBANのまま維持できないので全解除）
            bannedMap.delete(userId);
        } else {
            const filtered = current.filter(id => id !== channelId);
            if (filtered.length === 0) bannedMap.delete(userId);
            else bannedMap.set(userId, filtered);
        }
    }
    save();
}

function isMediaLinkBanned(userId, channelId = null) {
    if (!bannedMap.has(userId)) return false;
    const entry = bannedMap.get(userId);
    if (entry === null) return true; // 全チャンネルBAN
    if (channelId === null) return true; // チャンネル未指定でBAN確認 → BANあり扱い
    return entry.includes(channelId);
}

function getMediaLinkBanList() {
    return [...bannedMap.entries()].map(([userId, channels]) => ({
        userId,
        channels, // null=全チャンネル、string[]=指定チャンネル
    }));
}

module.exports = { isMediaLinkBanned, addMediaLinkBan, removeMediaLinkBan, getMediaLinkBanList };
