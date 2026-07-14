// chatter_persona.js — chatterの固定人格（キャラ）を保持・管理する
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const PERSONA_PATH = resolveDataPath('chatter_persona.json');
ensureDir(PERSONA_PATH);

// キャラ付け候補。一度選ばれたら固定人格として使い回す
const PERSONALITIES = [
    'いつもテンション高めの元気っ子。ノリがよく、話題に食いつきやすい。',
    '毒舌気味だけど根は優しいツッコミ役。ちょっとひねくれた言い方をする。',
    'マイペースな天然ボケ。会話の流れから少しズレたことをぽつりと言う。',
    '普段は無口でクールだが、たまにポツリと的確な一言を挟む。',
    '世話焼きなお姉ちゃん気質。みんなを気にかけるような発言をする。',
    '好きなことには早口オタク気味。ちょっとしたことにも妙に詳しい。',
    'いつも眠そうでのんびりした口調。テンションは低めだが場を和ませる。',
    '素直で前向き、いつも楽しそうにしているタイプ。',
];

let cache; // undefined = 未読込, null = 未設定, object = 設定済み

function load() {
    if (cache === undefined) cache = readJson(PERSONA_PATH, null);
    return cache;
}

function pickPersonality() {
    return PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];
}

// 固定人格を返す。未設定 or 対象がサーバーから居なくなっている場合はnull（呼び出し側で再選出してsetPersonaする）
async function getPersona(guild) {
    const persona = load();
    if (!persona) return null;
    const member = await guild.members.fetch(persona.lurkerId).catch(() => null);
    if (!member) return null;
    return { lurkerId: persona.lurkerId, personality: persona.personality, member };
}

function setPersona(lurkerId, personality = pickPersonality()) {
    const persona = { lurkerId, personality, createdAt: Date.now() };
    cache = persona;
    writeJson(PERSONA_PATH, persona);
    return persona;
}

module.exports = { getPersona, setPersona, pickPersonality };
