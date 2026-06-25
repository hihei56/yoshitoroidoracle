// seed_xp.js — 旧ボットからのXPデータ引き継ぎ（1回だけ実行）
require('dotenv').config();
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const XP_FILE = resolveDataPath('xp.json');
ensureDir(XP_FILE);

const store = readJson(XP_FILE, {});
if (!Array.isArray(store._excludedRoles)) store._excludedRoles = [];

// xp = 旧ボットの累計XP（そのまま引き継ぎ）
// level = 旧ボットのレベル
// levelBase = xp（このレベルに到達した時点 = 今 なので同値）
const seeds = [
    { id: '453542990343045120',  level: 46, xp: 202100, name: 'スマイリー山川' },
    { id: '1444282275612197006', level: 41, xp: 145800, name: '麻痺斗' },
    { id: '748064884662599690',  level: 38, xp: 117800, name: 'たゆやちゃん' },
    { id: '1096854565896323213', level: 38, xp: 117100, name: '特殊名称' },
    { id: '1014908051851051169', level: 33, xp: 80700,  name: '😿' },
    { id: '1474050297126064281', level: 31, xp: 70700,  name: 'アスペboxing' },
    { id: '1458088187854323867', level: 51, xp: 95500,  name: 'カンストユーザー' },
];

for (const { id, level, xp, name } of seeds) {
    store[id] = { xp, level, levelBase: xp };
    console.log(`✅  ${name} → Lv.${level} / ${xp.toLocaleString()} XP`);
}

writeJson(XP_FILE, store);
console.log('\n🎉 シード完了:', XP_FILE);
