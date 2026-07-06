// markov_chatter.js — サーバーの発言履歴を学習したMarkov連鎖でチャット生成
const Markov = require('markov-strings').default;
const { getTokenizer } = require('./japanese_tokenizer');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const CORPUS_PATH  = resolveDataPath('chatter_corpus.json');
const CORPUS_LIMIT = 3000;
const MIN_CORPUS_SIZE = 50; // これ未満は生成が不安定なため試みない（呼び出し側でAI生成にフォールバック）
const MAX_RECORD_LENGTH = 200; // 長文は学習対象外
const URL_REGEX = /https?:\/\/\S+/i;

ensureDir(CORPUS_PATH);
let corpus = readJson(CORPUS_PATH, []);

// markov-stringsは空白区切りの単語列を前提にしているため、日本語はkuromojiで分かち書きしてから渡す
// リンク・画像/動画などのメディア付き投稿は文章として不自然な断片になりやすいため学習対象外にする
async function recordForCorpus(content, hasMedia = false) {
    const text = content?.trim();
    if (!text || text.length > MAX_RECORD_LENGTH) return;
    if (hasMedia || URL_REGEX.test(text)) return;
    try {
        const tokenizer = await getTokenizer();
        const segmented = tokenizer.tokenize(text).map(t => t.surface_form).join(' ');
        corpus.push(segmented);
        if (corpus.length > CORPUS_LIMIT) corpus.splice(0, corpus.length - CORPUS_LIMIT);
        writeJson(CORPUS_PATH, corpus);
    } catch (e) {
        console.error('[MarkovChatter] コーパス追加エラー:', e.message);
    }
}

function generate() {
    if (corpus.length < MIN_CORPUS_SIZE) return null;
    try {
        const markov = new Markov({ stateSize: 2 });
        markov.addData(corpus);
        const result = markov.generate({
            maxTries: 30,
            filter: r => {
                const len = r.string.replace(/\s/g, '').length;
                return len >= 2 && len <= 100;
            },
        });
        return result.string.replace(/ /g, '');
    } catch (e) {
        // コーパスが少ない・条件に合う文が作れない場合は正常系として null を返す
        return null;
    }
}

module.exports = { recordForCorpus, generate };
