// exclude_manager.js — Oracle Cloud対応版
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const EXCLUDE_FILE = resolveDataPath('mod_exclude.json');
ensureDir(EXCLUDE_FILE);

let excludeList = readJson(EXCLUDE_FILE, []);

function getModExcludeList() { return excludeList; }

function addToExcludeList(userId) {
    if (!excludeList.includes(userId)) {
        excludeList.push(userId);
        writeJson(EXCLUDE_FILE, excludeList);
    }
}

function removeFromExcludeList(userId) {
    excludeList = excludeList.filter(id => id !== userId);
    writeJson(EXCLUDE_FILE, excludeList);
}

// admin.jsから呼ばれるadd/remove統合関数
function updateModExcludeList(userId, action) {
    if (action === 'add') addToExcludeList(userId);
    else                  removeFromExcludeList(userId);
}

module.exports = { getModExcludeList, addToExcludeList, removeFromExcludeList, updateModExcludeList };
