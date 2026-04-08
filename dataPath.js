// dataPath.js — データファイルパス解決（Oracle / Fly.io / ローカル 共通）
const path = require('path');
const fs   = require('fs');

function resolveDataPath(filename) {
    if (process.env.DATA_DIR)     return path.join(process.env.DATA_DIR, filename);
    if (process.env.FLY_APP_NAME) return path.join('/data', filename);
    return path.join(__dirname, filename);
}

function ensureDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[DataPath] ディレクトリ作成: ${dir}`);
    }
}

function readJson(filePath, fallback = []) {
    try {
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        console.error(`[DataPath] 読み込み失敗 ${filePath}:`, e.message);
    }
    return fallback;
}

function writeJson(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(`[DataPath] 書き込み失敗 ${filePath}:`, e.message);
    }
}

module.exports = { resolveDataPath, ensureDir, readJson, writeJson };
