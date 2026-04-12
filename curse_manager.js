// curse_manager.js — 呪いユーザー管理
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const CURSED_FILE = resolveDataPath('cursed_users.json');
ensureDir(CURSED_FILE);

let cursedSet = new Set(readJson(CURSED_FILE, []));

function save() { writeJson(CURSED_FILE, [...cursedSet]); }

function isCursed(userId)    { return cursedSet.has(userId); }
function addCurse(userId)    { cursedSet.add(userId);    save(); }
function removeCurse(userId) { cursedSet.delete(userId); save(); }
function getCursedList()     { return [...cursedSet]; }

module.exports = { isCursed, addCurse, removeCurse, getCursedList };
