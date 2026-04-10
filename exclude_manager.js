// exclude_manager.js — ユーザー・ロール両対応版
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const EXCLUDE_FILE = resolveDataPath('mod_exclude.json');
ensureDir(EXCLUDE_FILE);

// 旧形式（string[]）からの自動移行
function load() {
    const raw = readJson(EXCLUDE_FILE, { users: [], roles: [] });
    if (Array.isArray(raw)) return { users: raw, roles: [] };
    return { users: raw.users ?? [], roles: raw.roles ?? [] };
}

let excludeData = load();

function getModExcludeList() { return excludeData; }

function updateModExcludeList(id, action, type = 'user') {
    const key = type === 'role' ? 'roles' : 'users';
    if (action === 'add') {
        if (!excludeData[key].includes(id)) excludeData[key].push(id);
    } else {
        excludeData[key] = excludeData[key].filter(x => x !== id);
    }
    writeJson(EXCLUDE_FILE, excludeData);
}

function resetModExcludeList() {
    excludeData = { users: [], roles: [] };
    writeJson(EXCLUDE_FILE, excludeData);
}

module.exports = { getModExcludeList, updateModExcludeList, resetModExcludeList };
