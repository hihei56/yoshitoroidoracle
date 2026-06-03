// edit_monitor.js — メッセージ編集監視
const { EmbedBuilder } = require('discord.js');

// 監視ログを送るチャンネルID（env で上書き可）
const EDIT_LOG_CHANNEL_ID = process.env.EDIT_LOG_CHANNEL_ID || null;

// 投稿後この時間以上経過した編集を「古い編集」と判定（ミリ秒）
const OLD_MSG_THRESHOLD = 60 * 60 * 1000; // 1時間

// メディアリンクとみなす正規表現
const MEDIA_LINK_REGEX = /https?:\/\/\S+\.(?:mp4|mov|avi|webm|mkv|gif|gifv|png|jpe?g|webp|m3u8|mp3|ogg|wav)(\?[^\s]*)?/i;

// 外部サービスの動画・画像リンク
const MEDIA_SERVICE_REGEX = /https?:\/\/(?:tenor\.com|giphy\.com|gfycat\.com|streamable\.com|youtu\.be|youtube\.com\/shorts|clips\.twitch\.tv|medal\.tv|imgur\.com|i\.imgur\.com|reddit\.com\/gallery|v\.redd\.it)\//i;

// 日本語・英語以外の文字を含むか判定
// CJK統合漢字・ひらがな・カタカナ・英数字・記号以外が一定数あれば「他言語」
function detectForeignLanguage(text) {
    if (!text?.trim()) return false;
    // ひらがな・カタカナ・漢字・英数ASCII・一般的な記号・絵文字を除去して残りをカウント
    const stripped = text
        .replace(/[぀-ゟ゠-ヿ一-鿿㐀-䶿]/g, '') // 日本語
        .replace(/[A-Za-z0-9\s -~]/g, '')                              // ASCII英数字・記号
        .replace(/[！-｠￠-￦]/g, '')                            // 全角英数記号
        .replace(/[ -⁯℀-⅏☀-➿]/g, '')              // 記号・絵文字系
        .replace(/[\uD800-\uDFFF]/g, '')                                          // サロゲートペア（絵文字）
        .replace(/[​-‏‪-‮﻿]/g, '');                     // 制御文字
    return stripped.length >= 3;
}

function isMediaReplacement(oldContent, newContent) {
    if (!newContent) return false;
    const hadMedia = MEDIA_LINK_REGEX.test(oldContent) || MEDIA_SERVICE_REGEX.test(oldContent);
    const hasMedia = MEDIA_LINK_REGEX.test(newContent) || MEDIA_SERVICE_REGEX.test(newContent);
    // 元にメディアがなく、新しくメディアリンクが追加された
    return !hadMedia && hasMedia;
}

function buildDiff(oldText, newText) {
    const o = (oldText || '').slice(0, 500);
    const n = (newText || '').slice(0, 500);
    return { before: o || '*(空)*', after: n || '*(空)*' };
}

async function sendEditLog(client, embed) {
    if (!EDIT_LOG_CHANNEL_ID) return;
    try {
        const ch = await client.channels.fetch(EDIT_LOG_CHANNEL_ID);
        if (ch) await ch.send({ embeds: [embed] });
    } catch (e) {
        console.error('[EditMon] ログ送信失敗:', e.message);
    }
}

async function handleEditMonitor(oldMessage, newMessage) {
    if (!newMessage.guild) return;
    if (!EDIT_LOG_CHANNEL_ID) return;

    // partial解決
    if (newMessage.partial) {
        try { await newMessage.fetch(); } catch { return; }
    }

    const oldContent = oldMessage.partial ? null : (oldMessage.content ?? '');
    const newContent = newMessage.content ?? '';

    // 内容変化なし（embed展開など）はスキップ
    if (oldContent !== null && oldContent === newContent) return;

    const author     = newMessage.author;
    const isWebhook  = !!newMessage.webhookId;
    const channel    = newMessage.channel;
    const createdAt  = newMessage.createdTimestamp;
    const now        = Date.now();
    const age        = now - createdAt;
    const isOld      = age >= OLD_MSG_THRESHOLD;

    const { before, after } = buildDiff(oldContent, newContent);

    // アラート条件判定
    const mediaReplaced  = oldContent !== null && isMediaReplacement(oldContent, newContent);
    const foreignLang    = detectForeignLanguage(newContent);
    const isHighAlert    = isOld || mediaReplaced || foreignLang;

    const color = isHighAlert ? 0xFF0000 : 0xFFA500;

    const flags = [];
    if (isOld)         flags.push('⏰ 投稿から1時間以上経過');
    if (mediaReplaced) flags.push('📎 メディアリンクへの差し替え');
    if (foreignLang)   flags.push('🌐 日本語・英語以外の言語を検出');
    if (isWebhook)     flags.push('🔗 Webhookメッセージ');

    const ageMin  = Math.floor(age / 60000);
    const ageText = ageMin >= 60
        ? `${Math.floor(ageMin / 60)}時間${ageMin % 60}分`
        : `${ageMin}分`;

    const embed = new EmbedBuilder()
        .setTitle(isHighAlert ? '🚨 メッセージ編集アラート' : '📝 メッセージ編集')
        .setColor(color)
        .addFields(
            {
                name:   '投稿者',
                value:  author
                    ? `<@${author.id}> (${author.tag ?? author.username})`
                    : isWebhook ? `Webhook \`${newMessage.webhookId}\`` : '不明',
                inline: true,
            },
            { name: 'チャンネル',   value: `<#${channel.id}>`,        inline: true },
            { name: '投稿からの経過', value: ageText,                 inline: true },
            { name: '編集前',       value: `\`\`\`\n${before}\n\`\`\`` },
            { name: '編集後',       value: `\`\`\`\n${after}\n\`\`\`` },
        )
        .setTimestamp();

    if (flags.length > 0) {
        embed.addFields({ name: '⚠️ アラート理由', value: flags.join('\n') });
    }

    const jumpURL = newMessage.url;
    if (jumpURL) embed.addFields({ name: 'リンク', value: jumpURL, inline: true });

    const label = isHighAlert ? '🚨ALERT' : 'EDIT';
    console.log(`[EditMon] [${label}] ${author?.tag ?? 'webhook'}(${author?.id ?? newMessage.webhookId}) #${channel.name} age=${ageText} flags=${flags.map(f=>f.slice(2)).join(',') || 'none'}`);

    await sendEditLog(newMessage.client, embed);
}

module.exports = { handleEditMonitor };
