// medialink_manager.js — メディアリンクBAN管理
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const MEDIALINK_FILE = resolveDataPath('medialink_banned_users.json');
ensureDir(MEDIALINK_FILE);

let bannedSet = new Set(readJson(MEDIALINK_FILE, []));

function save() { writeJson(MEDIALINK_FILE, [...bannedSet]); }

function isMediaLinkBanned(userId) { return bannedSet.has(userId); }
function addMediaLinkBan(userId)   { bannedSet.add(userId);    save(); }
function removeMediaLinkBan(userId){ bannedSet.delete(userId); save(); }
function getMediaLinkBanList()     { return [...bannedSet]; }

module.exports = { isMediaLinkBanned, addMediaLinkBan, removeMediaLinkBan, getMediaLinkBanList };
