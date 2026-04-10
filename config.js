// config.js — Oracle Cloud対応版
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const SETTINGS_PATH = resolveDataPath('settings.json');
ensureDir(SETTINGS_PATH);

function getSettings() {
    const data = readJson(SETTINGS_PATH, null);
    if (!data) {
        const initial = { deniedUsers: [], deniedRoles: [] };
        writeJson(SETTINGS_PATH, initial);
        return initial;
    }
    // 旧形式からの移行（deniedRolesが存在しない場合）
    if (!data.deniedRoles) data.deniedRoles = [];
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

module.exports = { getSettings, saveSettings, resetSayDeny };
