#!/usr/bin/env node
// check.js — デプロイ前の動作確認スクリプト
// 実行: node check.js

const fs   = require('fs');
const path = require('path');

let ok = true;

function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); ok = false; }
function warn(msg) { console.log(`  ⚠️  ${msg}`); }
function section(title) { console.log(`\n【${title}】`); }

// ── 1. .env チェック ──────────────────────────────
section('.env');
require('dotenv').config();

const REQUIRED_ENVS = [
    'DISCORD_TOKEN',
    'GROQ_API_KEY',
    'UNTAI_WEBHOOK',
    'AI_WEBHOOK1',
    'AI_WEBHOOK2',
    'AI_WEBHOOK3',
];
const OPTIONAL_ENVS = [
    'DATA_DIR',
    'OPENAI_API_KEY',
    'YOUTUBE_API_KEY',
    'TWITCH_CLIENT_ID',
    'TWITCH_CLIENT_SECRET',
    'RANKING_WEBHOOK_URL',
    'DEBUG_MODE',
];

for (const key of REQUIRED_ENVS) {
    if (process.env[key]) pass(`${key} セット済み`);
    else                   fail(`${key} が未設定`);
}
for (const key of OPTIONAL_ENVS) {
    if (process.env[key]) pass(`${key} セット済み`);
    else                   warn(`${key} 未設定（オプション）`);
}

// ── 2. DATA_DIR チェック ─────────────────────────
section('DATA_DIR');
const dataDir = process.env.DATA_DIR;
if (!dataDir) {
    warn('DATA_DIR 未設定 → スクリプト同階層に保存されます');
} else if (!fs.existsSync(dataDir)) {
    fail(`DATA_DIR が存在しない: ${dataDir}\n     → mkdir -p ${dataDir} を実行してください`);
} else {
    // 書き込みテスト
    const testFile = path.join(dataDir, '.write_test');
    try {
        fs.writeFileSync(testFile, 'ok');
        fs.unlinkSync(testFile);
        pass(`DATA_DIR 書き込みOK: ${dataDir}`);
    } catch (e) {
        fail(`DATA_DIR に書き込めない: ${e.message}`);
    }
}

// ── 3. 必要ファイルの存在確認 ────────────────────
section('ファイル確認');
const REQUIRED_FILES = [
    'index.js', 'moderator.js', 'rssBot.js', 'scheduler.js',
    'exclude_manager.js', 'dataPath.js',
    'say.js', 'admin.js', 'joker.js', 'deathmatch.js',
    'ranking.js', 'timeoutlist.js',
];
for (const f of REQUIRED_FILES) {
    if (fs.existsSync(path.join(__dirname, f))) pass(f);
    else                                        fail(`${f} が見つからない`);
}

// ── 4. node_modules チェック ─────────────────────
section('npm パッケージ');
const REQUIRED_PKGS = [
    'discord.js', 'dotenv', 'axios',
    'openai', 'rss-parser', 'he', 'node-cron',
];
for (const pkg of REQUIRED_PKGS) {
    try {
        require.resolve(pkg);
        pass(pkg);
    } catch {
        fail(`${pkg} が未インストール → npm install ${pkg}`);
    }
}

// ── 結果 ─────────────────────────────────────────
console.log('\n' + '─'.repeat(40));
if (ok) {
    console.log('✅ 全チェック通過！pm2 start index.js で起動できます。');
} else {
    console.log('❌ 問題があります。上記の ❌ を修正してから起動してください。');
    process.exit(1);
}
