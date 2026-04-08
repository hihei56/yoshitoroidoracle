// config.js — Oracle Cloud対応版
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const SETTINGS_PATH = resolveDataPath('settings.json');
ensureDir(SETTINGS_PATH);

function getSettings() {
    const data = readJson(SETTINGS_PATH, null);
    if (!data) {
        const initial = { deniedUsers: [] };
        writeJson(SETTINGS_PATH, initial);
        return initial;
    }
    return data;
}

function saveSettings(settings) {
    writeJson(SETTINGS_PATH, settings);
}

module.exports = { getSettings, saveSettings };
