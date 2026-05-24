// impersonate_manager.js — なりすまし対象ユーザー管理
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const IMPERSONATE_FILE = resolveDataPath('impersonated_users.json');
ensureDir(IMPERSONATE_FILE);

let impersonateSet = new Set(readJson(IMPERSONATE_FILE, []));

function save() { writeJson(IMPERSONATE_FILE, [...impersonateSet]); }

function isImpersonated(userId)    { return impersonateSet.has(userId); }
function addImpersonate(userId)    { impersonateSet.add(userId);    save(); }
function removeImpersonate(userId) { impersonateSet.delete(userId); save(); }
function getImpersonateList()      { return [...impersonateSet]; }

module.exports = {
    isImpersonated,
    addImpersonate,
    removeImpersonate,
    getImpersonateList,
};