// config.js — Oracle Cloud対応版
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const SETTINGS_PATH = resolveDataPath('settings.json');
ensureDir(SETTINGS_PATH);

function getSettings() {
    const data = readJson(SETTINGS_PATH, null);
    if (!data) {
        const initial = { deniedUsers: [], deniedRoles: [], allowedSayChannels: [] };
        writeJson(SETTINGS_PATH, initial);
        return initial;
    }
    // 旧形式からの移行
    if (!data.deniedRoles)        data.deniedRoles        = [];
    if (!data.allowedSayChannels) data.allowedSayChannels = [];
    if (!data.anonLogChannelId)   data.anonLogChannelId   = null;
    if (!data.lurkerChannelId)    data.lurkerChannelId    = null;
    return data;
}

function saveSettings(settings) {
    writeJson(SETTINGS_PATH, settings);
}

function resetSayDeny() {
    const s = getSettings();
    s.deniedUsers = [];
    s.deniedRoles = [];
    saveSettings(s);
}

function resetSayChannels() {
    const s = getSettings();
    s.allowedSayChannels = [];
    saveSettings(s);
}

module.exports = { getSettings, saveSettings, resetSayDeny, resetSayChannels };
