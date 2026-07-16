// chatter_persona.js — chatterの固定人格（キャラ）を保持・管理する
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const PERSONA_PATH = resolveDataPath('chatter_persona.json');
ensureDir(PERSONA_PATH);

// メイン人格のキャラ付け候補。一度選ばれたら固定人格として使い回す
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

// 批評家・冷笑ポジションのキャラ付け候補（全肯定ムードに一人だけ水を差す役）
const CRITIC_PERSONALITIES = [
    '斜に構えた批評家肌。みんなが同じ空気で盛り上がっているときほど、あえて一歩引いた冷静なツッコミを入れたくなる。',
    '冷笑気味の皮肉屋。素直に同調せず、ちょっと斜めから茶化すような一言を挟む。',
    '妙に評論家ぶった物言いをするタイプ。「まあそれもわかるけど」的なワンクッション置いた反応をしがち。',
];

// 教養マウント役（脱構築・ポストモダン・カントなど誰も興味のない哲学の小話をドヤ顔で披露する高IQ自慢キャラ）
const MOUNT_PERSONALITY =
    '脱構築だのポストモダンだのカントだの、誰も興味のない哲学の小話をドヤ顔で披露してマウントを取りたがる教養マウント系。' +
    '高IQ自慢がにじむインテリぶった言い回しをする。';

// グルーミング仕草役（「よしよし」「すきだよ」「かわいい」など構って甘やかしてくるタイプ）
const GROOM_PERSONALITY =
    '「よしよし」「すきだよ」「かわいいね」のような、猫可愛がりするグルーミング仕草でみんなを甘やかしてくる溺愛タイプ。';

// スパム役（定型文を連呼して場を荒らすが、極稀に人が変わったように真剣な話をする）
const SPAM_PERSONALITY =
    '「う」「あ〜超うれしい！」「イーッヒッヒッヒッwww😂」のような定型文を連呼してノリで場を荒らす、テンションだけ高いスパム気味なキャラ。' +
    'ただし極稀に人が変わったように真剣なトーンになり、JDI（ジャパンディスプレイ）やキオクシアのような値動きの荒い銘柄の信用買い・投機的な短期売買を好む一面を見せる。';

// 動物画像役（Cat API/Dog APIなどから拾ってきた動物の画像をふと貼ってくるタイプ）
const ANIMAL_PERSONALITY =
    '猫や犬、キツネなどの動物画像をどこかから見つけてはふと貼ってくる、動物好きの共有魔。';

let cache; // undefined = 未読込

// 旧形式（フラットにmain相当のデータのみ保持）からの移行。新形式は任意のスロット名を持てるためそのまま保持する
function migrate(raw) {
    if (!raw) return { main: null, critic: null };
    if ('main' in raw || 'critic' in raw) return raw;
    return { main: raw, critic: null };
}

function load() {
    if (cache === undefined) cache = migrate(readJson(PERSONA_PATH, null));
    return cache;
}

function save() {
    writeJson(PERSONA_PATH, cache);
}

function pickPersonality() {
    return PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];
}

function pickCriticPersonality() {
    return CRITIC_PERSONALITIES[Math.floor(Math.random() * CRITIC_PERSONALITIES.length)];
}

// 固定人格を返す。未設定 or 対象がサーバーから居なくなっている場合はnull（呼び出し側で再選出してsetPersonaする）
async function getPersona(guild, slot = 'main') {
    const store   = load();
    const persona = store[slot];
    if (!persona) return null;
    const member = await guild.members.fetch(persona.lurkerId).catch(() => null);
    if (!member) return null;
    return { lurkerId: persona.lurkerId, personality: persona.personality, member };
}

function setPersona(lurkerId, personality, slot = 'main') {
    const store = load();
    const persona = { lurkerId, personality, createdAt: Date.now() };
    store[slot] = persona;
    save();
    return persona;
}

// 指定スロットの固定キャラをリセットする（次回投稿時に再抽選される）
function resetPersona(slot) {
    const store = load();
    delete store[slot];
    save();
}

module.exports = { getPersona, setPersona, resetPersona, pickPersonality, pickCriticPersonality, MOUNT_PERSONALITY, GROOM_PERSONALITY, SPAM_PERSONALITY, ANIMAL_PERSONALITY };
