// chatter_personas.js — chatterでなりすます各lurkerに、固定のキャラクター人格を持たせて管理する
// 一度割り当てたキャラは永続化し、同じ人が何度登場しても同じ性格で喋らせる
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const ARCHETYPES = [
    'テンション高めでノリがよく、短い相槌で場を盛り上げようとするキャラ',
    '冷静沈着でクールな一言居士。淡々とした短いコメントを好む',
    '軽く皮肉やツッコミを入れがちな毒舌気味のキャラ',
    'のんびりマイペースで、話が微妙に脱線しがちなキャラ',
    '気遣い屋で心配性、ちょっとした心配ごとを口にしがちなキャラ',
    'ノリツッコミが好きなお調子者',
    '基本無口だが、たまに的確な一言だけ返すキャラ',
    '妙にポジティブで励まし系のコメントをしがちなキャラ',
    'ちょっとオタク気質で、豆知識やうんちくを挟みがちなキャラ',
    '眠そうでテンションが低め、気だるい返しをするキャラ',
];

const PERSONA_FILE = resolveDataPath('chatter_personas.json');
ensureDir(PERSONA_FILE);
let _personaMap = readJson(PERSONA_FILE, {}); // lurkerId -> archetype文

function _save() {
    writeJson(PERSONA_FILE, _personaMap);
}

// 指定lurkerの人格を取得。未割り当てなら新規にランダム割り当てて永続化する
function getPersonaFor(lurkerId) {
    if (_personaMap[lurkerId]) return _personaMap[lurkerId];
    const archetype = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];
    _personaMap[lurkerId] = archetype;
    _save();
    console.log(`[ChatterPersonas] 新規割り当て: ${lurkerId} → 「${archetype}」`);
    return archetype;
}

module.exports = { getPersonaFor, ARCHETYPES };
