// lurker_picker.js — lurker選出ロジックの集約モジュール
// imp.js / moderator.js / impersonate_manager.js はここだけを呼ぶ

const { getLastActivity } = require('./activity_tracker');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

// ── 定数 ──
const TWO_WEEKS_MS  = 2 * 7 * 24 * 60 * 60 * 1000;
const STICKY_TTL_MS = 24 * 60 * 60 * 1000;

const EXCLUDE_ROLE_IDS = new Set([
    '1491824502169145484',
    '1477262864883515564',
    '1478715790575538359',
]);

// なりすまし対象から除外するユーザーID
// (/imp・/impersonateのターゲットにしない。/lurkerのメンション対象には影響しない)
const EXCLUDE_USER_IDS = new Set([
    '1477111665576251547',
]);

// lurker候補がいない場合のフォールバック10名
const FALLBACK_IDS = [
    '1081581933785534494',
    '968438324933066802',
    '1309591777812152374',
    '1281232317528145921',
    '226732837729075201',
    '1109225526050168932',
    '989519291785314335',
    '1209137581384802326',
    '621907420414738463',
    '1171784417828671502',
].filter(id => !EXCLUDE_USER_IDS.has(id));

// ── メンバーキャッシュ（5分） ──
let _membersCache   = null;
let _membersCacheTs = 0;
const CACHE_TTL_MS  = 5 * 60 * 1000;

async function fetchMembers(guild) {
    if (_membersCache && Date.now() - _membersCacheTs < CACHE_TTL_MS) {
        return _membersCache;
    }
    _membersCache   = await guild.members.fetch();
    _membersCacheTs = Date.now();
    return _membersCache;
}

// ── lurker判定 ──
// activity.json に記録がないメンバーは除外（joinedTimestamp代替による誤判定を防ぐ）
function isLurker(member) {
    if (member.user.bot) return false;
    if (member.permissions.has('Administrator')) return false;
    if ([...EXCLUDE_ROLE_IDS].some(id => member.roles.cache.has(id))) return false;
    if (EXCLUDE_USER_IDS.has(member.id)) return false; // ← なりすまし除外
    const last = getLastActivity(member.id);
    if (last === null) return false;
    return last < Date.now() - TWO_WEEKS_MS;
}

// ── フォールバック選出（連続同一人物なし） ──
async function _pickFallback(guild, lastPickedId) {
    const pool     = FALLBACK_IDS.filter(id => id !== lastPickedId);
    const shuffled = (pool.length > 0 ? pool : FALLBACK_IDS).sort(() => Math.random() - 0.5);
    for (const id of shuffled) {
        const m = await guild.members.fetch(id).catch(() => null);
        if (m) {
            console.log(`[LurkerPicker] フォールバック選出: ${m.user.tag}(${m.id})`);
            return m;
        }
    }
    return null;
}

// ── メイン選出 ──
async function pickOneLurker(guild, { lastPickedId = null } = {}) {
    const members = await fetchMembers(guild);
    const lurkers  = [...members.filter(isLurker).values()];

    console.log(
        `[LurkerPicker] 全メンバー: ${members.size} | lurker候補: ${lurkers.length}` +
        ` | 条件: 2週間無活動 + activity記録あり`
    );

    if (lurkers.length === 0) {
        console.warn('[LurkerPicker] lurker候補なし → フォールバック10名から選出');
        const m = await _pickFallback(guild, lastPickedId);
        return { member: m, fromFallback: true };
    }

    const others = lurkers.filter(m => m.id !== lastPickedId);
    const pool   = others.length > 0 ? others : lurkers;
    const picked = pool[Math.floor(Math.random() * pool.length)];

    console.log(`[LurkerPicker] 通常選出: ${picked.user.tag}(${picked.id})`);
    return { member: picked, fromFallback: false };
}

// ── sticky管理（/imp 用・実行者単位で24時間固定） ──
const STICKY_FILE = resolveDataPath('imp_sticky.json');
ensureDir(STICKY_FILE);
let _stickyMap = readJson(STICKY_FILE, {});

function _saveSticky() {
    writeJson(STICKY_FILE, _stickyMap);
}

function getSticky(executorUserId) {
    const s = _stickyMap[executorUserId];
    if (!s) return null;
    if (s.expiresAt < Date.now()) {
        delete _stickyMap[executorUserId];
        _saveSticky();
        return null;
    }
    return s.lurkerId;
}

function setSticky(executorUserId, lurkerId) {
    _stickyMap[executorUserId] = {
        lurkerId,
        expiresAt: Date.now() + STICKY_TTL_MS,
    };
    _saveSticky();
}

function clearSticky(executorUserId) {
    if (_stickyMap[executorUserId]) {
        delete _stickyMap[executorUserId];
        _saveSticky();
    }
}

module.exports = {
    pickOneLurker,
    fetchMembers,
    getSticky,
    setSticky,
    clearSticky,
    FALLBACK_IDS,
    TWO_WEEKS_MS,
    EXCLUDE_ROLE_IDS,
};