// snipe.js
const { EmbedBuilder } = require('discord.js');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// チャンネルIDごとに最後の削除メッセージを1件保持
const snipeCache = new Map();

const CATEGORY_LABELS = {
    'sexual/minors':          '🚨 性的・未成年',
    'sexual':                 '🔞 性的',
    'hate':                   '🤬 ヘイト',
    'hate/threatening':       '🤬 ヘイト（脅迫）',
    'harassment':             '😡 ハラスメント',
    'harassment/threatening': '😡 ハラスメント（脅迫）',
    'self-harm':              '😔 自傷',
    'self-harm/intent':       '😔 自傷（意図）',
    'self-harm/instructions': '😔 自傷（方法）',
    'violence':               '💢 暴力',
    'violence/graphic':       '💢 暴力（グロ）',
};

function storeDeletedMessage(message) {
    if (message.author?.bot) return;
    if (!message.guild)      return;
    snipeCache.set(message.channelId, {
        authorId:  message.author?.id   ?? null,
        authorTag: message.author?.tag  ?? '不明',
        content:   message.content      ?? '',
        createdAt: message.createdAt    ?? new Date(),
        channelId: message.channelId,
    });
}

async function runAiModeration(text) {
    if (!text?.trim() || !process.env.OPENAI_API_KEY) return null;
    try {
        const result = await openai.moderations.create({
            model: 'omni-moderation-latest',
            input: text,
        });
        const scores = result.results[0]?.category_scores ?? {};
        const flags  = result.results[0]?.categories       ?? {};
        const hits = Object.entries(CATEGORY_LABELS)
            .filter(([cat]) => flags[cat])
            .map(([cat, label]) => ({ cat, label, score: scores[cat] ?? 0 }))
            .sort((a, b) => b.score - a.score);
        return { flagged: hits.length > 0, hits };
    } catch (e) {
        console.error('[Snipe AI Mod]:', e.message);
        return null;
    }
}

async function handleSnipe(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.channel;
    const cached  = snipeCache.get(channel.id);

    if (!cached) {
        return interaction.editReply({ content: 'このチャンネルに最近の削除メッセージはありません。' });
    }

    const modResult = await runAiModeration(cached.content);

    const embed = new EmbedBuilder()
        .setColor(modResult?.flagged ? 0xFF0000 : 0x5865F2)
        .setAuthor({ name: cached.authorTag })
        .setTimestamp(cached.createdAt)
        .setFooter({ text: `User ID: ${cached.authorId ?? '不明'}` });

    if (modResult?.flagged) {
        // フラグありの場合、内容は最大50文字の伏せ字プレビュー＋カテゴリ表示
        const preview = cached.content.length > 50
            ? cached.content.slice(0, 50).replace(/./g, '█') + '…（省略）'
            : '█'.repeat(cached.content.length) || '（添付ファイルのみ）';
        embed.setTitle('⚠️ 削除メッセージ（要注意コンテンツ）');
        embed.addFields({
            name: '内容プレビュー（伏せ字）',
            value: `\`\`\`${preview}\`\`\``,
        });
        const catText = modResult.hits
            .map(h => `${h.label}  \`${(h.score * 100).toFixed(1)}%\``)
            .join('\n');
        embed.addFields({ name: 'AIモデレーション カテゴリ', value: catText });
    } else {
        embed.setTitle('🗑️ 削除メッセージ');
        embed.setDescription(cached.content || '（テキストなし）');
        if (modResult) {
            embed.addFields({ name: 'AIモデレーション', value: '✅ 問題なし' });
        }
    }

    await interaction.editReply({ embeds: [embed] });
}

module.exports = { storeDeletedMessage, handleSnipe };
