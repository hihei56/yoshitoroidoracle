// snipe.js — 過去ログNGスキャン（管理者限定）
// DCE（DiscordChatExporter）のCSV/JSON両対応
const { AttachmentBuilder } = require('discord.js');
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
    '女子小学生','女子中学生','じょしこうせい(?=.*(?:えっち|エッチ|性的|わいせつ))',
    'おさな(?:妻|い子)',
    '年端もいかない',
    'cp(?:画像|動画|写真)',
    'minors?\\s*(?:only|just|with|and)',
    'minor\\s*attract',
    'map(?:community|pride|flag)',
    'hebephil','ephebophil',
    '子供(?:に|と)?(?:性的|わいせつ|えっち|エッチ)',
    '少女',
    '少年(?:愛|に性的|わいせつ)',
    '児(?:ポ|童|の性|に性的|わいせつ)',
    '(?:女の子|男の子|子供|こども)(?:の)?(?:裸|ヌード|えっち|エッチ|性的|わいせつ|に手を出)',
    '子(?:の)?(?:裸|ヌード)(?:画像|写真|動画)',
    '(?:保育|幼稚)園(?:児)?(?:に性的|わいせつ|えっち|エッチ)',
    'ランドセル',
    '制服(?:えっち|エッチ|sex|ポルノ|わいせつ)',
    '体操着(?:えっち|エッチ|sex)',
    '水着(?:の子|の少女|の女児)',
    '放課後(?:えっち|エッチ|sex|わいせつ|に誘)',
    'jailbait',
    'preteen',
    'underage\\s*(?:sex|porn|nude|girl|boy)',
    'child\\s*(?:sex|sexual|molest|abuse|exploit)',
    'girl\\s*(?:next\\s*door)?\\s*(?:underage|minor)',
    'JK','JC','JS',
].join('|'), 'i');

const AGE_REGEX = new RegExp([
    '(?<![0-9０-９])(?:[0-9]|1[0-2])(?:歳|才|さい)',
    '(?<![0-9０-９])(?:[０-９]|１[０-２])(?:歳|才|さい)',
    '(?:一|二|三|四|五|六|七|八|九|十|十一|十二)(?:歳|才|さい)',
    '13歳未満','小[1-6]','中[1-3]',
    '(?<![0-9])(?:[1-9]|1[0-2])\\s*(?:yo|y\\/o|year\\W*old)',
    'u\\s*18(?![0-9])',
].join('|'), 'i');

const THREAT_REGEX = new RegExp([
    '殺','死ね','しね','死ねよ','死んでしまえ',
    '殺す','ころす','殺してやる','殺すぞ','ぶっ殺',
    '爆破','爆殺','刺す','刺してやる','刺すぞ',
    '銃(?:で撃|で殺)',
    'kill\\s*you',"i'?ll\\s*kill",'gonna\\s*kill','want\\s*(?:you\\s*)?dead',
    '自殺しろ','死んでください','死んでほしい','死んでくれ',
    'お前(?:は|が)?(?:死|消え)(?:ろ|ねよ|んでしまえ)',
    'テロ(?:を起こせ|しろ|実行)',
    '大量虐殺(?:しろ|せよ|万歳)',
    'mass\\s*shoot(?:ing)?',
    'school\\s*shoot(?:ing)?',
    '無差別(?:殺人|テロ|攻撃)(?:しろ|やれ|万歳)',
].join('|'), 'i');

const DRUG_REGEX = new RegExp([
    '覚醒剤','覚せい剤','MDM[Aa]','コカイン','ヘロイン',
    '大麻','マリファナ','危険ドラッグ','脱法ドラッグ',
    'シャブ','やく(?:を|買|売|やる)',
    'drug\\s*deal','sell\\s*drug',
].join('|'), 'i');

const SELF_HARM_PROMO_REGEX = new RegExp([
    '首吊り(?:方法|やり方|場所|ひも|紐|ロープ|のしかた)',
    '首を吊る(?:方法|やり方)',
    '飛び降り(?:方法|やり方|場所|名所|スポット)',
    '飛び降りる(?:場所|方法)',
    '自殺(?:方法|のやり方|のしかた|の仕方|名所|スポット|する方法|したい|しようかな|を考え|について教)',
    '死に方(?:を教|教えて|知りたい)',
    '楽に死ぬ(?:方法|には|方)',
    '安楽死(?:方法|のやり方)',
    'od(?:の仕方|やり方|方法|量|して死)',
    '睡眠薬(?:で死|を飲んで死)',
    '過剰摂取(?:の量|方法|のやり方)',
    'リストカット(?:の仕方|方法|やり方)',
    'リスカ(?:の仕方|方法)',
    '練炭自殺',
    '入水自殺(?:場所|方法)',
    '焼身自殺(?:の仕方|方法)',
    '電車(?:に飛び込む|で自殺)(?:方法|場所)',
    '(?:もう)?死(?:にたい|のう|んでしまいたい|にたくなった)',
    '生きていたくない',
    '生きてる意味(?:がない|ない|わからない)',
    '消えてしまいたい',
    'suicide(?:\\s*method|\\s*how|\\s*spot|\\s*note|\\s*bridge)',
    'how\\s*to\\s*(?:kill\\s*myself|commit\\s*suicide|end\\s*(?:my\\s*)?life)',
    '(?<![不生])死(?!後|去|亡|者|体|骸|因|刑|語|角|球|守|蔵|闘|力|文|海|化|滅|傷|節|地|相|票)',
].join('|'), 'i');

const HATE_REGEX = new RegExp([
    'チャンコロ',
    'チョンコ',
    'チョン(?:め|野郎|は死ね|出て行け|ども)',
    '支那(?:人め|め|野郎|女め|人)',
    '(?:外国人|移民|難民|在日)(?:は|を)?(?:出て(?:いけ|行け|ろ)|追い出せ|帰れ(?:よ|！|$)|殺せ)',
    '(?:ゴキブリ|害虫|寄生虫|ウジ虫|ゴミ)(?:外国人|移民|在日|黒人|朝鮮人|韓国人|中国人)',
    '(?:外国人|移民|在日|黒人|朝鮮人|韓国人|中国人)(?:ゴキブリ|害虫|寄生虫|ウジ虫|ゴミ)',
    '(?:ムスリム|イスラム|ユダヤ|LGBT|障害者|黒人|外国人)(?:は)?(?:消えろ|いなくなれ|死ね|殺せ|根絶やし)',
    '(?:人種|民族|外国人)(?:を)?(?:浄化|根絶|駆逐)',
    '生きるに値しない命',
    '生きる価値(?:の)?ない(?:命|人間|存在)',
    '(?:障害者|精神障害者|知的障害者)(?:は)?(?:生きる価値がない|社会のお荷物|不要な存在)',
    '(?:ゲイ|同性愛者|LGBT)(?:で)?(?:黒人|外国人|ユダヤ)',
    'nigger','nigga',
    'n\\s*[-_]\\s*word',
    'ニガー','ニガ(?!ー)',
    '黒人(?:は|が|を|め|野郎|ども)?(?:死ね|消えろ|ゴミ|クズ|猿|バカ|出て行け|帰れ|嫌い)',
    '(?:死ね|消えろ|ゴミ|クズ|猿|害虫)(?:黒人)',
    'kike',
    'ユダヤ(?:の陰謀|が世界を支配|人め|人野郎|人を殺|人は出て行け)',
    'ホロコースト(?:は嘘|なかった|否定|でたらめ)',
    'holocaust\\s*(?:denial|lie|fake|hoax|didn)',
    'antisemit',
    'white\\s*(?:power|supremac|nationalist|genocide)',
    'heil\\s*hitler',
    'ハイル\\s*ヒトラー',
    'ナチス(?:万歳|最高|を支持|賛美|正しい|復活)',
    '14\\s*words',
    '(?:88|卍)\\s*(?:heil|hell|万歳)',
    'white\\s*lives\\s*matter(?!\\s*too)',
    'chink','チンク',
    'gook',
    '(?:朝鮮|韓国)人(?:は)?(?:ゴキブリ|害虫|寄生虫|猿|死ね|消えろ|出て行け)',
    '(?:中国|シナ)人(?:は)?(?:ゴキブリ|害虫|寄生虫|猿|死ね|消えろ)',
    'jap\\s*(?:die|kill|out)',
    'towelhead','raghead',
    'sand\\s*n(?:igger|igga)',
    'camel\\s*jockey',
    'muslim\\s*(?:ban|terrorist|bomb)',
    'ethnic\\s*cleansing',
    'race\\s*(?:war|traitor|mixing\\s*is)',
    'genocide\\s*(?:now|the|all)',
    '(?:民族|人種)(?:の)?浄化',
    '(?:外国人|移民)(?:排斥|根絶|駆逐)(?:せよ|しろ|万歳)',
    '売国(?:奴|者)',
    'spic','beaner','wetback',
    'cracker(?:\\s*ass)?\\s*cracker',
    'slope','zipperhead',
    'curry\\s*(?:muncher|nigger)',
    'paki',
    'ゲイ','げい',
    'レズ','れず','レズビアン',
    'ホモ','ほも',
    'オカマ','おかま','お釜','オネエ',
    'ニューハーフ','ﾆｭｰﾊｰﾌ',
    'オナベ','おなべ',
    'バイ(?:セクシャル|セクシュアル)',
    'クィア','クエスチョニング',
    'トランス(?:ジェンダー|セクシャル|女性|男性)',
    'LGBT','LGBTQ',
    '同性愛(?:者)?',
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
    'スペ(?:め|かよ|すぎ|だろ|だな|ども)',
    'キチガイ','きちがい',
    '基地外',
    'メンヘラ(?:死ね|消えろ|うざ)',
    '精神異常(?:者め|者は)',
    'キ○ガイ','キ◯ガイ',
    'retard(?:ed)?',
    'spastic',
    'mental(?:ly)?\\s*(?:ill\\s*(?:freak|scum)|retard)',
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

    // ヘッダー行をスキップ（最初の行がヘッダーか判定）
    const firstLine = lines[0];
    const startIdx = /^AuthorID/i.test(firstLine) ? 1 : 0;

    const messages = [];
    for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // 簡易CSV分割（ダブルクォート対応）
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
            // ファイル名からチャンネルIDを抽出（DCEのデフォルト命名: "... [channelId].csv"）
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

    // Webhookに通報
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

            // レート制限対策
            await new Promise(r => setTimeout(r, 500));
        }

        await interaction.editReply(
            `🔍 ${messages.length}件スキャン完了。**${hits.length}件**のNGヒット → ${sent}件を通報チャンネルに送信しました。`
        );
    } else {
        // SCAN_REPORT_WEBHOOK_URL未設定時はインタラクションに直接表示
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
