// ng_word_manager.js — 臨時NGワード管理（moderator.jsの検閲対象に追加）
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const NG_WORD_FILE = resolveDataPath('ng_words.json');
ensureDir(NG_WORD_FILE);

let ngWords = readJson(NG_WORD_FILE, []);

function pruneExpired() {
    const now = Date.now();
    const before = ngWords.length;
    ngWords = ngWords.filter(w => !w.expiresAt || w.expiresAt > now);
    if (ngWords.length !== before) writeJson(NG_WORD_FILE, ngWords);
}

function getNgWords() {
    pruneExpired();
    return ngWords;
}

function addNgWord(word, addedBy, durationMinutes = null) {
    pruneExpired();
    const normalized = word.trim();
    if (!normalized) return null;

    const expiresAt = durationMinutes ? Date.now() + durationMinutes * 60_000 : null;
    const existing = ngWords.find(w => w.word === normalized);
    if (existing) {
        existing.expiresAt = expiresAt;
        existing.addedBy = addedBy;
        existing.addedAt = Date.now();
    } else {
        ngWords.push({ word: normalized, addedBy, addedAt: Date.now(), expiresAt });
    }
    writeJson(NG_WORD_FILE, ngWords);
    return normalized;
}

function removeNgWord(word) {
    pruneExpired();
    const normalized = word.trim();
    const before = ngWords.length;
    ngWords = ngWords.filter(w => w.word !== normalized);
    writeJson(NG_WORD_FILE, ngWords);
    return ngWords.length !== before;
}

module.exports = { getNgWords, addNgWord, removeNgWord };
