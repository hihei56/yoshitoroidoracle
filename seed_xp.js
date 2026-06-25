// seed_xp.js — 旧ボットからのXPデータ引き継ぎ（1回だけ実行）
require('dotenv').config();
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const XP_FILE     = resolveDataPath('xp.json');
const XP_PER_LEVEL = 70;

ensureDir(XP_FILE);

const store = readJson(XP_FILE, {});
if (!Array.isArray(store._excludedRoles)) store._excludedRoles = [];

const seeds = [
    { id: '453542990343045120',  level: 46,  name: 'スマイリー山川' },
    { id: '1444282275612197006', level: 41,  name: '麻痺斗' },
    { id: '748064884662599690',  level: 38,  name: 'たゆやちゃん' },
    { id: '1096854565896323213', level: 38,  name: '特殊名称' },
    { id: '1014908051851051169', level: 33,  name: '😿' },
    { id: '1474050297126064281', level: 31,  name: 'アスペboxing' },
    { id: '1458088187854323867', level: 99,  name: 'カンストユーザー' },
];

for (const { id, level, name } of seeds) {
    if (store[id]) {
        console.log(`⏭  ${name} (${id}) は既存データあり → スキップ`);
        continue;
    }
    store[id] = { xp: level * XP_PER_LEVEL, level };
    console.log(`✅  ${name} → Lv.${level} / ${level * XP_PER_LEVEL} XP`);
}

writeJson(XP_FILE, store);
console.log('\n🎉 シード完了:', XP_FILE);
