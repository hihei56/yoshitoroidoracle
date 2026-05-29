// snipe.js — 過去ログNGスキャン（管理者限定）
// DCE（DiscordChatExporter）のCSV/JSON両対応
const https = require('https');
const http  = require('http');

// ─── NG判定ロジック（moderator.jsから独立コピー） ───

function normalizeForDetection(text) {
    if (!text) return '';
    return text
        .replace(/[！-～]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
        .replace(/[​-‏⁠⁡﻿­]/g, '')
        .toLowerCase()
        .replace(/[\s　_\-.,。、・「」『』【】〔〕《》〈〉（）()\[\]{}*★☆◆◇●○]/g, '');
}

const LOLI_SHOTA_REGEX = new RegExp([
    'ロリ','ろり','ﾛﾘ','loli',
    'ショタ','しょた','ｼｮﾀ','shota',
    'ロリコン','ろりこん','lolicon',
    'ショタコン','しょたこん','shotacon',
    '幼女','幼男','キッズ',
    '小学生','中学生','小学校','中学校',
    'ペド','ぺど',
    'p\\W*e\\W*d\\W*o',
    '小児性愛','幼児性愛','小児愛',
    'ペドフィリア','ペドフィール',
    '援交','えんこう','援助交際',
    '児童ポルノ','児童買春','児童わいせつ',
    '幼児わいせつ','幼児淫行',
    'csam',
    'child\\W*porn','child\\W*abuse\\W*mater',
    'エプスタイン','🧒','👧','👦','🍼','🎒',
    '児童','未成年',
    'ガキ','がき',
    '女児','男児','幼児',
    '乳児','乳幼児','園児','新生児',
    '女子小学生','女子中学生','じょしこうせい',
    'おさな(?:妻|い子)',
    '年端もいかない',
    'cp',
    'minor',
    'map(?:community|pride|flag)',
    'hebephil','ephebophil',
    '少女',
    '少年愛',
    '児ポ',
    '制服',
    '体操着',
    '水着',
    'ランドセル',
    '放課後',
    'jailbait',
    'preteen',
    'underage',
    'child\\s*(?:sex|sexual|molest|abuse|exploit)',
    'JK','JC','JS',
].join('|'), 'i');

const AGE_REGEX = new RegExp([
    '(?:[0-9]|1[0-2])(?:歳|才|さい)',
    '(?:[０-９]|１[０-２])(?:歳|才|さい)',
    '(?:一|二|三|四|五|六|七|八|九|十|十一|十二)(?:歳|才|さい)',
    '13歳未満','小[1-6]','中[1-3]',
    '(?:[1-9]|1[0-2])\\s*(?:yo|y\\/o|year\\W*old)',
    'u\\s*18',
].join('|'), 'i');

const THREAT_REGEX = new RegExp([
    '殺','死ね','しね','死ねよ','死んでしまえ',
    '殺す','ころす','殺してやる','殺すぞ','ぶっ殺',
    '爆破','爆殺','刺す','刺してやる','刺すぞ',
    '銃',
    'kill\\s*you',"i'?ll\\s*kill",'gonna\\s*kill','want\\s*(?:you\\s*)?dead',
    '自殺しろ','死んでください','死んでほしい','死んでくれ',
    'テロ',
    '大量虐殺',
    'mass\\s*shoot(?:ing)?',
    'school\\s*shoot(?:ing)?',
    '無差別殺人','無差別テロ','無差別攻撃',
].join('|'), 'i');

const DRUG_REGEX = new RegExp([
    '覚醒剤','覚せい剤','MDM[Aa]','コカイン','ヘロイン',
    '大麻','マリファナ','危険ドラッグ','脱法ドラッグ',
    'シャブ','やく',
    'drug',
].join('|'), 'i');

const SELF_HARM_PROMO_REGEX = new RegExp([
    '首吊り',
    '首を吊る',
    '飛び降り',
    '自殺',
    '死に方',
    '楽に死ぬ',
    '安楽死',
    'od',
    '睡眠薬',
    '過剰摂取',
    'リストカット',
    'リスカ',
    '練炭自殺',
    '入水自殺',
    '焼身自殺',
    '電車に飛び込む',
    '死にたい','死のう','死んでしまいたい','死にたくなった',
    '生きていたくない',
    '生きてる意味',
    '消えてしまいたい',
    'suicide',
    'kill\\s*myself',
    'commit\\s*suicide',
].join('|'), 'i');

const HATE_REGEX = new RegExp([
    'チャンコロ',
    'チョンコ',
    'チョン',
    '支那',
    '在日',
    '民族浄化','人種浄化',
    '生きるに値しない命',
    '生きる価値ない',
    'nigger','nigga',
    'n\\s*[-_]\\s*word',
    'ニガー','ニガ',
    '黒人(?:死ね|消えろ|猿|ゴミ|クズ)',
    'kike',
    'ユダヤ',
    'ホロコースト(?:は嘘|なかった|否定)',
    'holocaust\\s*(?:denial|lie|fake|hoax)',
    'antisemit',
    'white\\s*power','white\\s*supremac','white\\s*nationalist',
    'heil\\s*hitler',
    'ハイル\\s*ヒトラー',
    'ナチス',
    '14\\s*words',
    '88\\s*(?:heil|万歳)',
    'white\\s*lives\\s*matter',
    'chink','チンク',
    'gook',
    '朝鮮人(?:ゴキブリ|害虫|猿|死ね|消えろ)',
    '韓国人(?:ゴキブリ|害虫|猿|死ね|消えろ)',
    'シナ人',
    'jap',
    'towelhead','raghead',
    'sand\\s*n(?:igger|igga)',
    'camel\\s*jockey',
    'ethnic\\s*cleansing',
    'race\\s*war',
    'genocide',
    '外国人排斥','移民排斥','外国人駆逐',
    '売国',
    'spic','beaner','wetback',
    'slope','zipperhead',
    'curry\\s*(?:muncher|nigger)',
    'paki',
    'ゲイ','げい',
    'レズ','れず','レズビアン',
    'ホモ','ほも',
    'オカマ','おかま','お釜','オネエ',
    'ニューハーフ','ﾆｭｰﾊｰﾌ',
    'オナベ','おなべ',
    'バイセクシャル','バイセクシュアル',
    'クィア','クエスチョニング',
    'トランスジェンダー','トランスセクシャル',
    'LGBT','LGBTQ',
    '同性愛',
    'ふたなり',
].join('|'), 'i');

const DISABILITY_HATE_REGEX = new RegExp([
    'かたわ',
    'びっこ',
    'めくら',
    'つんぼ',
    'いざり',
    '知恵遅れ',
    'ガイジ',
    'ハッタショ',
    'アスペ',
    'スペ',
    'キチガイ','きちがい',
    '基地外',
    'メンヘラ',
    '精神異常',
    'キ○ガイ','キ◯ガイ',
    'retard',
    'spastic',
    'mental(?:ly)?\\s*retard',
].join('|'), 'i');

function checkNgWords(text) {
    const matched = [];
    function testAndCapture(regex, label) {
        const m = text.match(regex);
        if (m) matched.push(`${label}(${m[0].slice(0, 20)})`);
    }
    testAndCapture(LOLI_SHOTA_REGEX,      'loli_shota');
    testAndCapture(AGE_REGEX,             'age');
    testAndCapture(THREAT_REGEX,          'threat');
    testAndCapture(DRUG_REGEX,            'drug');
    testAndCapture(SELF_HARM_PROMO_REGEX, 'self_harm_promo');
    testAndCapture(HATE_REGEX,            'hate_speech');
    testAndCapture(DISABILITY_HATE_REGEX, 'disability_hate');
    return { hit: matched.length > 0, matched };
}

// ─── ファイル取得 ───

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        mod.get(url, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            res.on('error', reject);
        }).on('error', reject);
    });
}

// ─── DCE CSV パーサー ───
// 列: AuthorID, Author, Date, Content, Attachments, Reactions

function parseCsv(text) {
    const lines = text.split('\n');
    if (lines.length < 2) return [];

    const firstLine = lines[0];
    const startIdx = /^AuthorID/i.test(firstLine) ? 1 : 0;

    const messages = [];
    for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = splitCsvLine(line);
        if (cols.length < 4) continue;

        messages.push({
            authorId:   (cols[0] || '').trim(),
            authorName: (cols[1] || '').trim(),
            date:       (cols[2] || '').trim(),
            content:    (cols[3] || '').trim(),
        });
    }
    return messages;
}

function splitCsvLine(line) {
    const cols = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
            else inQuote = !inQuote;
        } else if (ch === ',' && !inQuote) {
            cols.push(cur); cur = '';
        } else {
            cur += ch;
        }
    }
    cols.push(cur);
    return cols;
}

// ─── DCE JSON パーサー ───

function parseJson(text) {
    const data = JSON.parse(text);
    const guildId   = data.guild?.id   ?? '0';
    const channelId = data.channel?.id ?? '0';
    const messages  = (data.messages ?? []).map(msg => ({
        authorId:   msg.author?.id   ?? '',
        authorName: msg.author?.name ?? '',
        date:       msg.timestamp    ?? '',
        content:    msg.content      ?? '',
        messageId:  msg.id           ?? '',
        guildId,
        channelId,
    }));
    return { messages, guildId, channelId };
}

// ─── Webhook送信 ───

async function sendWebhookReport(embed) {
    const url = process.env.SCAN_REPORT_WEBHOOK_URL;
    if (!url) return;

    const body = JSON.stringify({ embeds: [embed] });
    const urlObj = new URL(url);
    const mod = urlObj.protocol === 'https:' ? https : http;

    await new Promise((resolve, reject) => {
        const req = mod.request({
            hostname: urlObj.hostname,
            path:     urlObj.pathname + urlObj.search,
            method:   'POST',
            headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, res => {
            res.resume();
            res.on('end', resolve);
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ─── /snipe コマンドハンドラ ───

async function handleSnipe(interaction) {
    if (!interaction.member?.permissions.has('Administrator')) {
        return interaction.reply({ content: '管理者のみ実行できます。', ephemeral: true });
    }

    const file = interaction.options.getAttachment('file');
    if (!file) {
        return interaction.reply({ content: 'ファイルを添付してください。', ephemeral: true });
    }

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'json'].includes(ext)) {
        return interaction.reply({ content: 'CSVまたはJSONファイルを添付してください。', ephemeral: true });
    }

    if (file.size > 50 * 1024 * 1024) {
        return interaction.reply({ content: 'ファイルサイズが大きすぎます（上限50MB）。', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    let messages;
    let guildId   = '0';
    let channelId = '0';

    try {
        const raw = await fetchUrl(file.url);

        if (ext === 'json') {
            const parsed = parseJson(raw);
            messages  = parsed.messages;
            guildId   = parsed.guildId;
            channelId = parsed.channelId;
        } else {
            const m = file.name.match(/\[(\d{17,20})\]/);
            if (m) channelId = m[1];
            messages = parseCsv(raw);
        }
    } catch (e) {
        console.error('[Snipe] ファイル読み込みエラー:', e);
        return interaction.editReply('ファイルの読み込みに失敗しました。');
    }

    if (!messages.length) {
        return interaction.editReply('メッセージが見つかりませんでした。');
    }

    const hits = [];
    for (const msg of messages) {
        if (!msg.content) continue;
        const normalized = normalizeForDetection(msg.content);
        const { hit, matched } = checkNgWords(normalized);
        if (hit) {
            hits.push({ ...msg, matched });
        }
    }

    const reportUrl = process.env.SCAN_REPORT_WEBHOOK_URL;

    if (!hits.length) {
        return interaction.editReply(`✅ ${messages.length}件スキャン完了。NGヒットなし。`);
    }

    if (reportUrl) {
        let sent = 0;
        for (const hit of hits) {
            const msgLink = hit.messageId
                ? `https://discord.com/channels/${hit.guildId}/${hit.channelId}/${hit.messageId}`
                : `https://discord.com/channels/0/${channelId}/0`;

            const embed = {
                color:       0xff4040,
                title:       `🚨 NGワード検出`,
                description: `**カテゴリ:** ${hit.matched.join(', ')}\n**リンク:** ${msgLink}`,
                fields: [
                    { name: '発言者', value: hit.authorName || hit.authorId || '不明', inline: true },
                    { name: '日時',   value: hit.date || '不明', inline: true },
                    { name: '内容',   value: (hit.content || '').slice(0, 300) || '(空)', inline: false },
                ],
                footer: { text: `ファイル: ${file.name}` },
            };

            try {
                await sendWebhookReport(embed);
                sent++;
            } catch (e) {
                console.error('[Snipe] Webhook送信失敗:', e.message);
            }

            await new Promise(r => setTimeout(r, 500));
        }

        await interaction.editReply(
            `🔍 ${messages.length}件スキャン完了。**${hits.length}件**のNGヒット → ${sent}件を通報チャンネルに送信しました。`
        );
    } else {
        const lines = hits.map(h => {
            const link = h.messageId
                ? `https://discord.com/channels/${h.guildId}/${h.channelId}/${h.messageId}`
                : `https://discord.com/channels/0/${channelId}/0`;
            return `• [${h.authorName}] ${link}\n  カテゴリ: ${h.matched.join(', ')}\n  内容: ${(h.content || '').slice(0, 100)}`;
        }).join('\n\n');

        const report = `🔍 ${messages.length}件スキャン完了。**${hits.length}件**のNGヒット:\n\n${lines}`.slice(0, 1900);
        await interaction.editReply(report);
    }
}

module.exports = { handleSnipe };
