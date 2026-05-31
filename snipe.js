// snipe.js
const { EmbedBuilder, ChannelType } = require('discord.js');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── ゼロ幅文字デコード（moderator.js と同ロジック）───
const REVERSE_ZERO_WIDTH = { '​': '0', '‌': '1' };
const ZERO_WIDTH_SEP     = '‍';

function extractUserId(text) {
    if (!text) return null;
    const bits = [];
    for (const c of text) {
        if (REVERSE_ZERO_WIDTH[c]) bits.push(REVERSE_ZERO_WIDTH[c]);
        else break;
    }
    if (!bits.length) return null;
    try { return BigInt('0b' + bits.join('')).toString(); }
    catch { return null; }
}

function stripZeroWidth(text) {
    if (!text) return '';
    return [...text].filter(c => !REVERSE_ZERO_WIDTH[c] && c !== ZERO_WIDTH_SEP).join('');
}

// ─── AIモデレーションカテゴリ ───
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

// ─── NGジャンル正規表現 ───
const NG_GENRE_REGEX = {
    loli:      /ロリ|ろり|ﾛﾘ|loli|ショタ|しょた|shota|幼女|幼男|少女|jailbait|preteen|csam|児童ポルノ|JK|JC|JS/i,
    threat:    /殺|死ね|しね|爆破|爆殺|刺す|kill\s*you|i'?ll\s*kill|gonna\s*kill|テロ|大量虐殺/i,
    drug:      /覚醒剤|覚せい剤|コカイン|ヘロイン|大麻|マリファナ|シャブ|drug\s*deal|sell\s*drug/i,
    self_harm: /首吊り|飛び降り|自殺|リストカット|リスカ|suicide|how\s*to\s*kill\s*myself|練炭/i,
    hate:      /チャンコロ|チョンコ|nigger|nigga|white\s*power|white\s*supremac|heil\s*hitler|ナチス万歳|holocaust\s*denial/i,
};

// ─── 削除メッセージキャッシュ: channelId → { authorId, authorTag, content, webhookId, createdAt } ───
const snipeCache = new Map();

// ─── スレッドキャッシュ: cacheKey → threadId ───
const threadCache = new Map();

// ─── 削除メッセージを記録（index.js の MessageDelete から呼ぶ）───
function storeDeletedMessage(message) {
    if (!message.guild) return;
    // 通常メッセージ
    if (!message.author?.bot) {
        snipeCache.set(message.channelId, {
            authorId:  message.author?.id  ?? null,
            authorTag: message.author?.tag ?? '不明',
            content:   message.content     ?? '',
            webhookId: null,
            createdAt: message.createdAt   ?? new Date(),
            channelId: message.channelId,
        });
        return;
    }
    // Webhookメッセージ（botフラグが立つ）
    if (message.webhookId) {
        const authorId = extractUserId(message.content);
        snipeCache.set(message.channelId, {
            authorId,
            authorTag: authorId ? `Webhook(<@${authorId}>)` : 'Webhook(不明)',
            content:   stripZeroWidth(message.content) ?? '',
            webhookId: message.webhookId,
            createdAt: message.createdAt ?? new Date(),
            channelId: message.channelId,
        });
    }
}

// ─── AIモデレーション ───
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

// ─── スレッド取得 or 作成（キャッシュ付き）───
async function getOrCreateSnipeThread(interaction, cacheKey, threadName) {
    // キャッシュ済みスレッドが生きているか確認
    const cachedId = threadCache.get(cacheKey);
    if (cachedId) {
        const existing = await interaction.guild.channels.fetch(cachedId).catch(() => null);
        if (existing) return existing;
        threadCache.delete(cacheKey);
    }

    // 親チャンネルを解決
    const parent = interaction.channel.isThread()
        ? interaction.channel.parent
        : interaction.channel;

    // 既存スレッドの名前検索（再起動後のキャッシュ喪失対策）
    await parent.threads.fetchActive().catch(() => {});
    const found = parent.threads.cache.find(t => t.name === threadName);
    if (found) {
        threadCache.set(cacheKey, found.id);
        return found;
    }

    const thread = await parent.threads.create({
        name:                threadName,
        autoArchiveDuration: 1440,
        type:                ChannelType.PrivateThread,
        reason:              'snipe bulk result',
    });
    threadCache.set(cacheKey, thread.id);
    return thread;
}

// ─── メインハンドラ ───
async function handleSnipe(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const channel        = interaction.channel;
    const targetUserId   = interaction.options.getString('user_id')?.trim()   || null;
    const includeWebhook = interaction.options.getBoolean('include_webhook')  ?? true;
    const ngGenre        = interaction.options.getString('ng_genre')           || null;

    // ── NGジャンル一括取得モード ──
    if (ngGenre) {
        return handleBulkScan(interaction, { targetUserId, includeWebhook, ngGenre });
    }

    // ── 通常スナイプ（最後の削除メッセージ）──
    const cached = snipeCache.get(channel.id);

    if (!cached) {
        return interaction.editReply({ content: 'このチャンネルに最近の削除メッセージはありません。' });
    }

    // ユーザーIDフィルタ
    if (targetUserId && cached.authorId !== targetUserId) {
        return interaction.editReply({ content: `<@${targetUserId}> の削除メッセージはキャッシュにありません。` });
    }

    // Webhookフィルタ
    if (!includeWebhook && cached.webhookId) {
        return interaction.editReply({ content: 'Webhookメッセージは除外されています（include_webhook=false）。' });
    }

    const modResult = await runAiModeration(cached.content);

    const embed = new EmbedBuilder()
        .setColor(modResult?.flagged ? 0xFF0000 : 0x5865F2)
        .setAuthor({ name: cached.authorTag })
        .setTimestamp(cached.createdAt)
        .setFooter({ text: `User ID: ${cached.authorId ?? '不明'}${cached.webhookId ? ' | Webhook' : ''}` });

    if (modResult?.flagged) {
        const preview = cached.content.length > 50
            ? cached.content.slice(0, 50).replace(/./g, '█') + '…（省略）'
            : '█'.repeat(cached.content.length) || '（添付ファイルのみ）';
        embed.setTitle('⚠️ 削除メッセージ（要注意コンテンツ）');
        embed.addFields({ name: '内容プレビュー（伏せ字）', value: `\`\`\`${preview}\`\`\`` });
        const catText = modResult.hits
            .map(h => `${h.label}  \`${(h.score * 100).toFixed(1)}%\``)
            .join('\n');
        embed.addFields({ name: 'AIモデレーション カテゴリ', value: catText });
    } else {
        embed.setTitle('🗑️ 削除メッセージ');
        embed.setDescription(cached.content || '（テキストなし）');
        if (modResult) embed.addFields({ name: 'AIモデレーション', value: '✅ 問題なし' });
    }

    await interaction.editReply({ embeds: [embed] });
}

// ─── NGジャンル一括スキャン ───
async function handleBulkScan(interaction, { targetUserId, includeWebhook, ngGenre }) {
    const guild    = interaction.guild;
    const ngRegex  = NG_GENRE_REGEX[ngGenre];
    if (!ngRegex) {
        return interaction.editReply(`不明なNGジャンル: ${ngGenre}`);
    }

    const channels = guild.channels.cache.filter(ch =>
        ch.isTextBased() &&
        !ch.isThread() &&
        ch.type !== ChannelType.GuildVoice &&
        ch.type !== ChannelType.GuildCategory
    );

    const results = [];

    for (const [, ch] of channels) {
        let messages;
        try { messages = await ch.messages.fetch({ limit: 100 }); }
        catch { continue; }

        for (const [, msg] of messages) {
            const isWebhook = !!msg.webhookId;
            if (isWebhook && !includeWebhook) continue;

            const authorId = isWebhook
                ? extractUserId(msg.content)
                : msg.author?.id ?? null;

            if (targetUserId && authorId !== targetUserId) continue;

            const plainText = isWebhook
                ? stripZeroWidth(msg.content)
                : (msg.content || '');

            if (!ngRegex.test(plainText)) continue;

            results.push({ url: msg.url, authorId, chId: ch.id, isWebhook });
        }
    }

    if (results.length === 0) {
        return interaction.editReply('該当するメッセージが見つかりませんでした。');
    }

    // スレッド取得 or 作成（キャッシュ利用）
    const labelParts = [`ng:${ngGenre}`];
    if (targetUserId) labelParts.unshift(`uid:${targetUserId}`);
    const threadName = `🔍 snipe ${labelParts.join(' ')}`.slice(0, 100);
    const cacheKey   = `${guild.id}:${targetUserId ?? 'all'}:${ngGenre}`;

    let thread;
    try {
        thread = await getOrCreateSnipeThread(interaction, cacheKey, threadName);
    } catch (e) {
        console.error('[snipe] スレッド作成失敗:', e.message);
        return interaction.editReply(`スレッド作成に失敗しました: ${e.message}`);
    }

    // 結果を2000文字以内に分割投稿
    const lines = results.map(r => {
        const who = r.authorId ? `<@${r.authorId}>` : '(不明)';
        const wh  = r.isWebhook ? ' `wh`' : '';
        return `- [link](${r.url}) ${who} <#${r.chId}>${wh}`;
    });

    const header = `**${results.length}件** (${new Date().toLocaleString('ja-JP')})\n`;
    const chunks = [];
    let buf = header;
    for (const line of lines) {
        if (buf.length + line.length + 1 > 1900) { chunks.push(buf); buf = line; }
        else buf += (buf ? '\n' : '') + line;
    }
    if (buf) chunks.push(buf);

    for (const chunk of chunks) {
        await thread.send({ content: chunk, allowedMentions: { parse: [] } }).catch(() => {});
    }

    await interaction.editReply(`✅ ${results.length}件を <#${thread.id}> に投稿しました。`);
    console.log(`[SNIPE] guild=${guild.id} user=${targetUserId ?? 'all'} genre=${ngGenre} hits=${results.length}`);
}

module.exports = { storeDeletedMessage, handleSnipe };
