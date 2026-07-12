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
    if (!data.anonLogChannelId)       data.anonLogChannelId       = null;
    if (!data.lurkerChannelId)        data.lurkerChannelId        = null;
    if (data.chatterChannelId === undefined) data.chatterChannelId = null;
    if (data.shiritoriChannelId === undefined) data.shiritoriChannelId = null;
    if (data.rankingChannelId === undefined) data.rankingChannelId = null;
    if (data.vcRecruitChannelId === undefined) data.vcRecruitChannelId = null;
    if (data.vcRecruitRoleId === undefined) data.vcRecruitRoleId = null;
    if (!data.editMonitorExcludedUsers) data.editMonitorExcludedUsers = [];
    if (!data.editMonitorExcludedRoles) data.editMonitorExcludedRoles = [];
    if (data.rssChannelId === undefined) data.rssChannelId = null;
    if (!data.ttsUserVoices) data.ttsUserVoices = {};
    if (data.chineseThinkerReplace === undefined)     data.chineseThinkerReplace     = true;
    if (!data.chineseThinkerExcludeUsers)             data.chineseThinkerExcludeUsers = [];
    if (!data.cryAllowedUsers)                        data.cryAllowedUsers = [];
    if (data.rtaChannelId === undefined) data.rtaChannelId = null;
    if (!data.spamTargetRoles) data.spamTargetRoles = [];
    if (!data.chatterAiProvider) data.chatterAiProvider = 'groq';
    if (data.chatterAiModel === undefined) data.chatterAiModel = null;
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
