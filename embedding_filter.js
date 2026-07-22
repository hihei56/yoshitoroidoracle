// embedding_filter.js — ローカル埋め込みモデルによる意味的類似度チェック
// APIキー不要・課金なし。@huggingface/transformersでモデルをローカル実行し、
// 正規表現(LOLI_SHOTA_REGEX等)が拾えない言い換え・婉曲表現を意味的類似度で補足する。
const MODEL_NAME          = process.env.EMBEDDING_MODEL || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const SIMILARITY_THRESHOLD = Number(process.env.EMBEDDING_CSAM_THRESHOLD) || 0.72;
const MIN_TEXT_LENGTH      = 4;
const MAX_QUEUE_SIZE       = Number(process.env.EMBEDDING_MAX_QUEUE) || 20;

// 児童性的搾取の典型的な言い回し（言い換え検知の基準文）
const REFERENCE_TEXTS = [
    '子供に性的なことをしたい',
    '小学生とHなことがしたい',
    '幼い子供の裸の画像が欲しい',
    '児童ポルノを探している',
    'ロリコンの画像を共有しよう',
    '未成年と性的な関係を持ちたい',
    '子供を性的に虐待する動画がある',
    '女子小学生とエッチしたい',
    '幼女の裸の写真をくれ',
    '子供を騙してわいせつなことをする方法',
    '中学生に卑猥なことを言いたい',
    '小さい子とそういう関係になりたい',
    'ちっちゃい子とえっちなことしたい',
    '小さい女の子と二人きりでイケナイことしたい',
    '幼い子にいたずらしたい',
    '子供とそういう関係になりたい',
    'i want to have sex with a child',
    'looking for child porn images',
    'nude photos of young girls for sale',
    'how to groom a minor for sex',
];

let extractorPromise    = null;
let referenceEmbeddings = null;

function getExtractor() {
    if (!extractorPromise) {
        extractorPromise = (async () => {
            const { pipeline } = await import('@huggingface/transformers');
            return pipeline('feature-extraction', MODEL_NAME);
        })();
    }
    return extractorPromise;
}

async function embed(extractor, text) {
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return output.data;
}

function cosineSimilarity(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot; // 両ベクトルとも正規化済みなので内積=コサイン類似度
}

async function ensureReferenceEmbeddings(extractor) {
    if (!referenceEmbeddings) {
        referenceEmbeddings = await Promise.all(REFERENCE_TEXTS.map(t => embed(extractor, t)));
    }
    return referenceEmbeddings;
}

async function runCheck(text) {
    try {
        const extractor = await getExtractor();
        const refs      = await ensureReferenceEmbeddings(extractor);
        const vec       = await embed(extractor, text);

        let bestScore = -1;
        let bestIndex = -1;
        for (let i = 0; i < refs.length; i++) {
            const score = cosineSimilarity(vec, refs[i]);
            if (score > bestScore) { bestScore = score; bestIndex = i; }
        }

        return {
            hit:     bestScore >= SIMILARITY_THRESHOLD,
            score:   bestScore,
            matched: bestIndex >= 0 ? REFERENCE_TEXTS[bestIndex] : null,
        };
    } catch (e) {
        console.error('[EMBEDDING] チェック失敗:', e.message);
        return { hit: false, score: 0, matched: null };
    }
}

// 同時実行数1に直列化するキュー。溜まりすぎたら新規分はスキップして安全側にフォールバック
// （Botの応答が詰まるのを防ぐため。誤って見逃した分は正規表現/AIモデレーション側の網に任せる）
let queueDepth = 0;
let tail       = Promise.resolve();

async function checkChildSafetyEmbedding(text) {
    if (!text || text.trim().length < MIN_TEXT_LENGTH) return { hit: false, score: 0, matched: null };

    if (queueDepth >= MAX_QUEUE_SIZE) {
        console.warn(`[EMBEDDING] キュー超過(${queueDepth}件待ち)のためスキップ`);
        return { hit: false, score: 0, matched: null };
    }

    queueDepth++;
    const result = tail.then(() => runCheck(text));
    tail = result.catch(() => {});
    try {
        return await result;
    } finally {
        queueDepth--;
    }
}

module.exports = { checkChildSafetyEmbedding };
