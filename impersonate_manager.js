// impersonate_manager.js — なりすまし対象ユーザー管理
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const IMPERSONATE_FILE = resolveDataPath('impersonated_users.json');
ensureDir(IMPERSONATE_FILE);

// なりすまされる対象ユーザーID（lurker.jsと同じ定義）
const EXCLUDE_ROLE_IDS = new Set([
    '1491824502169145484',
    '1477262864883515564',
    '1478715790575538359',
]);

// なりすまし発動中のユーザーセット { victimUserId: true }
let impersonateSet = new Set(readJson(IMPERSONATE_FILE, []));

function save() { writeJson(IMPERSONATE_FILE, [...impersonateSet]); }

function isImpersonated(userId) { return impersonateSet.has(userId); }
function addImpersonate(userId)  { impersonateSet.add(userId);    save(); }
function removeImpersonate(userId) { impersonateSet.delete(userId); save(); }
function getImpersonateList() { return [...impersonateSet]; }

/**
 * lurker条件（3週間以上無活動）に合致するメンバーから
 * ランダムに1人ピックして返す
 */
const THREE_WEEKS_MS = 3 * 7 * 24 * 60 * 60 * 1000;

async function pickLurker(guild, { getLastActivity }) {
    const members = await guild.members.fetch().catch(() => null);
    if (!members) return null;

    const threshold = Date.now() - THREE_WEEKS_MS;

    const lurkers = [...members.filter(m => {
        if (m.user.bot) return false;
        if (m.permissions.has('Administrator')) return false;
        if ([...EXCLUDE_ROLE_IDS].some(id => m.roles.cache.has(id))) return false;
        const last = getLastActivity(m.id);
        if (last === null) return (m.joinedTimestamp ?? 0) < threshold;
        return last < threshold;
    }).values()];

    if (!lurkers.length) return null;
    return lurkers[Math.floor(Math.random() * lurkers.length)];
}

module.exports = {
    isImpersonated, addImpersonate, removeImpersonate, getImpersonateList,
    pickLurker,
};