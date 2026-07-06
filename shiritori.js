// shiritori.js — しりとりゲーム（kuromoji.jsでかな変換・辞書判定）
const { EmbedBuilder } = require('discord.js');
const { getSettings, saveSettings } = require('./config');
const { getTokenizer } = require('./japanese_tokenizer');

const HISTORY_LIMIT = 200;

const SMALL_TO_LARGE = {
    'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お',
    'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'っ': 'つ', 'ゎ': 'わ',
};

const gameState = new Map(); // channelId -> { currentWord: {surface, reading, last} | null, history: Set<string> }

function initShiritori() {
    getTokenizer()
        .then(() => console.log('[Shiritori] ✅ 辞書ロード完了'))
        .catch(e => console.error('[Shiritori] 辞書ロード失敗:', e.message));
}

function katakanaToHiragana(str) {
    return str.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// 単一の既知形態素として認識できる場合のみ「辞書に存在する単語」として扱う
// （複数形態素に分割される＝辞書上の単一語として登録されていない、とみなす簡易判定）
async function analyzeWord(surface) {
    const tokenizer = await getTokenizer();
    const tokens = tokenizer.tokenize(surface);
    if (tokens.length !== 1 || tokens[0].word_type !== 'KNOWN') return null;
    const reading = tokens[0].reading || tokens[0].surface_form;
    return { reading: katakanaToHiragana(reading) };
}

// 語尾の長音符「ー」は直前の文字の母音を引き継ぐため、簡易的に除去して直前の文字を実質の語尾とする
function getReadingEdges(reading) {
    const trimmed = reading.replace(/ー+$/, '') || reading;
    const chars = [...trimmed];
    const last = SMALL_TO_LARGE[chars[chars.length - 1]] ?? chars[chars.length - 1];
    const first = SMALL_TO_LARGE[chars[0]] ?? chars[0];
    return { first, last, full: trimmed };
}

function resetShiritoriGame(channelId) {
    if (!channelId) return;
    gameState.set(channelId, { currentWord: null, history: new Set() });
}

function buildEmbed(color, description) {
    return new EmbedBuilder().setColor(color).setDescription(description);
}

async function handleShiritoriMessage(message) {
    try {
        if (message.author.bot || !message.guild) return;

        const settings = getSettings();
        const channelId = settings.shiritoriChannelId;
        if (!channelId || message.channel.id !== channelId) return;

        const surface = message.content?.trim();
        if (!surface) return;

        let info;
        try {
            info = await analyzeWord(surface);
        } catch (e) {
            console.error('[Shiritori] 解析エラー:', e.message);
            return;
        }

        if (!info) {
            await message.reply({ embeds: [buildEmbed(0xED4245, '❌ 辞書に見つかりませんでした。実在する単語（名詞など）を入力してください。')] }).catch(() => {});
            return;
        }

        const { first, last, full } = getReadingEdges(info.reading);
        if (!full) {
            await message.reply({ embeds: [buildEmbed(0xED4245, '❌ 有効な単語として認識できませんでした。')] }).catch(() => {});
            return;
        }

        let state = gameState.get(channelId);
        if (!state) {
            state = { currentWord: null, history: new Set() };
            gameState.set(channelId, state);
        }

        if (last === 'ん') {
            gameState.set(channelId, { currentWord: null, history: new Set() });
            await message.reply({ embeds: [buildEmbed(0xFEE75C, `💀 「ん」で終わったので **${message.author.username}** の負けです！しりとりをリセットしました。`)] }).catch(() => {});
            return;
        }

        if (state.currentWord && state.currentWord.last !== first) {
            await message.reply({ embeds: [buildEmbed(0xED4245, `❌ 前の単語の語尾「${state.currentWord.last}」から始まる言葉にしてください。`)] }).catch(() => {});
            return;
        }

        if (state.history.has(full)) {
            await message.reply({ embeds: [buildEmbed(0xED4245, '❌ その単語はすでに使われています。')] }).catch(() => {});
            return;
        }

        state.history.add(full);
        if (state.history.size > HISTORY_LIMIT) {
            state.history.delete(state.history.values().next().value);
        }
        state.currentWord = { surface, reading: full, last };

        await message.reply({ embeds: [buildEmbed(0x57F287, `✅ **${surface}**（${full}）\n次は「${last}」から始まる言葉をどうぞ！`)] }).catch(() => {});
    } catch (e) {
        console.error('[Shiritori] 処理エラー:', e);
    }
}

module.exports = { initShiritori, handleShiritoriMessage, resetShiritoriGame };
