// long_text_filter.js — 特定チャンネルで特定ユーザーが規定行数を超える長文（Wikipedia等のコピペ）を
// 投稿した場合に自動削除する。削除対象はコマンドで指定したユーザーの発言のみ。
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const TARGETS_FILE = resolveDataPath('long_text_targets.json');
ensureDir(TARGETS_FILE);

const DEFAULT_MAX_LINES = 15;

let targets = readJson(TARGETS_FILE, []);

function save() {
    writeJson(TARGETS_FILE, targets);
}

function findIndex(userId, channelId) {
    return targets.findIndex(t => t.userId === userId && t.channelId === channelId);
}

function addTarget(userId, channelId, maxLines = DEFAULT_MAX_LINES) {
    const idx = findIndex(userId, channelId);
    if (idx >= 0) targets[idx].maxLines = maxLines;
    else targets.push({ userId, channelId, maxLines });
    save();
}

// channelIdを省略すると、そのユーザーの設定を全チャンネル分まとめて解除
function removeTarget(userId, channelId = null) {
    const before = targets.length;
    targets = channelId
        ? targets.filter(t => !(t.userId === userId && t.channelId === channelId))
        : targets.filter(t => t.userId !== userId);
    save();
    return before !== targets.length;
}

function listTargets() {
    return targets;
}

// 空行を除いた行数で判定（段落区切りの空行だけで水増しされないようにする）
function countLines(content) {
    return content.split('\n').filter(line => line.trim().length > 0).length;
}

async function checkLongText(message) {
    try {
        if (message.author.bot || !message.guild) return;

        const target = targets.find(t => t.userId === message.author.id && t.channelId === message.channel.id);
        if (!target) return;

        const lines = countLines(message.content);
        if (lines <= target.maxLines) return;

        console.warn(`[LongTextFilter] 削除: ${message.author.tag}(${message.author.id}) lines=${lines}/${target.maxLines} channel=${message.channel.id}`);
        if (message.deletable) await message.delete().catch(() => {});
    } catch (e) {
        console.error('[LongTextFilter] 処理エラー:', e);
    }
}

module.exports = { addTarget, removeTarget, listTargets, checkLongText, DEFAULT_MAX_LINES };
