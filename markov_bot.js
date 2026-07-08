// markov_bot.js — 特定ロールの発言をMarkov連鎖で学習し、ネタ文を生成するお遊びコマンド
// ※ 誰かになりすますことはせず、Bot自身の発言として投稿する
const { getTokenizer } = require('./japanese_tokenizer');
const { checkNgWords, normalizeForDetection } = require('./moderator');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

// 学習対象ロール
const TARGET_ROLE_ID = '1517458777677369536';

const CORPUS_FILE  = resolveDataPath('markov_corpus.json');
const CORPUS_LIMIT = 3000; // 直近3000発言分だけ保持
const MIN_TOKENS   = 3;    // 短すぎる発言（スタンプのみ等）は学習しない
const MAX_GEN_TOKENS = 40;

const BOS = '\u0002';
const EOS = '\u0003';

ensureDir(CORPUS_FILE);
let corpus = readJson(CORPUS_FILE, []); // string[][]（各発言のトークン配列）
let dirty  = false;

let saveTimer = null;
function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { writeJson(CORPUS_FILE, corpus); saveTimer = null; }, 30_000);
}

function stripForLearning(content) {
    return content
        .replace(/<a?:\w+:\d+>/g, '')      // カスタム絵文字
        .replace(/<@!?\d+>/g, '')          // メンション
        .replace(/<#\d+>/g, '')            // チャンネルリンク
        .replace(/<@&\d+>/g, '')           // ロールメンション
        .replace(/https?:\/\/\S+/g, '')    // URL
        .trim();
}

/* ===== 学習（メッセージ収集） ===== */
async function recordMarkovMessage(message) {
    if (!message.member?.roles.cache.has(TARGET_ROLE_ID)) return;
    const cleaned = stripForLearning(message.content ?? '');
    if (!cleaned) return;

    const { hit } = checkNgWords(normalizeForDetection(cleaned));
    if (hit) return; // NGワードを含む発言は学習しない

    try {
        const tokenizer = await getTokenizer();
        const tokens = tokenizer.tokenize(cleaned).map(t => t.surface_form).filter(Boolean);
        if (tokens.length < MIN_TOKENS) return;

        corpus.push(tokens);
        if (corpus.length > CORPUS_LIMIT) corpus.splice(0, corpus.length - CORPUS_LIMIT);
        dirty = true;
        scheduleSave();
    } catch (e) {
        console.error('[MarkovBot] 学習エラー:', e.message);
    }
}

/* ===== 連鎖構築（コーパスが変化した時だけ再構築） ===== */
let chain = null; // Map<"prev1..prev2", string[]>

function buildChain() {
    chain = new Map();
    for (const tokens of corpus) {
        const seq = [BOS, BOS, ...tokens, EOS];
        for (let i = 2; i < seq.length; i++) {
            const key = `${seq[i - 2]}\u0001${seq[i - 1]}`;
            if (!chain.has(key)) chain.set(key, []);
            chain.get(key).push(seq[i]);
        }
    }
    dirty = false;
}

function generateSentence() {
    if (dirty || !chain) buildChain();
    if (chain.size === 0) return null;

    let prev1 = BOS, prev2 = BOS;
    const out = [];
    for (let i = 0; i < MAX_GEN_TOKENS; i++) {
        const candidates = chain.get(`${prev1}\u0001${prev2}`);
        if (!candidates || !candidates.length) break;
        const next = candidates[Math.floor(Math.random() * candidates.length)];
        if (next === EOS) break;
        out.push(next);
        prev1 = prev2;
        prev2 = next;
    }
    return out.join('').trim();
}

/* ===== コマンドハンドラ ===== */
async function handleMarkov(interaction) {
    await interaction.deferReply();

    const role = await interaction.guild.roles.fetch(TARGET_ROLE_ID).catch(() => null);
    const roleName = role?.name ?? '謎の';

    // NGワードを含んでしまった場合は数回だけ引き直す
    let text = null;
    for (let i = 0; i < 5; i++) {
        const candidate = generateSentence();
        if (!candidate) break;
        const { hit } = checkNgWords(normalizeForDetection(candidate));
        if (!hit) { text = candidate; break; }
    }

    if (!text) {
        return interaction.editReply('まだ学習データが足りないみたいです……もう少し発言が溜まってから試してください。');
    }

    await interaction.editReply(`🎭 **${roleName}bot（もどき）**: ${text}`);
}

module.exports = { recordMarkovMessage, handleMarkov, TARGET_ROLE_ID };
