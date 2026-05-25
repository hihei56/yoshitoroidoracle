// imp.js — /imp コマンド
// lurkerになりすまして発言する（1495971497016164492ロール + 管理者が実行可能）
const { MessageFlags } = require('discord.js');
const { pickOneLurker, fetchMembers, getSticky, setSticky, clearSticky } = require('./lurker_picker');

const ALLOWED_ROLE = '1495971497016164492';
const MAX_CHARS    = 150;

// ── ゼロ幅文字 ──
const ZERO_WIDTH_MAP     = { '0': '\u200B', '1': '\u200C' };
const REVERSE_ZERO_WIDTH = { '\u200B': '0', '\u200C': '1' };
const ZERO_WIDTH_SEP     = '\u200D';

function encodeId(id) {
    return [...BigInt(id).toString(2)].map(b => ZERO_WIDTH_MAP[b]).join('');
}

function extractUserIds(text) {
    if (!text) return { authorId: null, displayId: null };
    const bits = [];
    for (const c of text) {
        if (REVERSE_ZERO_WIDTH[c]) bits.push(REVERSE_ZERO_WIDTH[c]);
        else break;
    }
    if (!bits.length) return { authorId: null, displayId: null };
    try {
        const authorId = BigInt('0b' + bits.join('')).toString();
        const rest = [...text].slice(bits.length);
        if (rest[0] !== ZERO_WIDTH_SEP) return { authorId, displayId: authorId };
        const lurkerBits = [];
        for (const c of rest.slice(1)) {
            if (REVERSE_ZERO_WIDTH[c]) lurkerBits.push(REVERSE_ZERO_WIDTH[c]);
            else break;
        }
        if (!lurkerBits.length) return { authorId, displayId: authorId };
        const lurkerId = BigInt('0b' + lurkerBits.join('')).toString();
        return { authorId, displayId: lurkerId };
    } catch { return { authorId: null, displayId: null }; }
}

function buildHiddenPrefix(authorId, lurkerId) {
    return encodeId(authorId) + ZERO_WIDTH_SEP + encodeId(lurkerId);
}

function sanitizeMentions(text) {
    if (!text) return text;
    return text
        .replace(/@everyone/g, '@\u200beveryone')
        .replace(/@here/g,     '@\u200bhere');
}

// sticky未使用時の連続同一人物防止
let _lastLurkerId = null;

const webhookCache = new Map();

async function handleImp(interaction) {
    const { member, channel, options, client, guild, user } = interaction;

    // ── 権限チェック ──
    const hasPermission =
        member.permissions.has('Administrator') ||
        member.roles.cache.has(ALLOWED_ROLE);

    if (!hasPermission) {
        return interaction.reply({
            content: '実行権限がありません。',
            flags: [MessageFlags.Ephemeral],
        });
    }

    // ── stickyオプション ──
    // true=このlurkerに24時間固定, false=固定解除, null=現状維持
    const stickyOpt = options.getBoolean('sticky');

    // false指定なら先にクリアして通常選出へ
    if (stickyOpt === false) {
        clearSticky(user.id);
    }

    // ── 文字数チェック ──
    const rawContent = options.getString('content') || '';
    if (rawContent.length > MAX_CHARS) {
        return interaction.reply({
            content: `長すぎます（${MAX_CHARS}文字以内）。`,
            flags: [MessageFlags.Ephemeral],
        });
    }

    const content = sanitizeMentions(rawContent);
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
        // ── lurker決定 ──
        let lurker = null;
        const existingSticky = getSticky(user.id); // clearSticky後なのでfalse時はnull

        if (existingSticky) {
            // sticky有効 → 同じlurkerを使い続ける
            const members = await fetchMembers(guild);
            lurker = members.get(existingSticky) ?? null;
            if (!lurker) {
                // sticky対象がサーバーを抜けていたら解除して再選出
                clearSticky(user.id);
            }
        }

        if (!lurker) {
            // 通常選出（連続同一人物なし）
            const { member: picked } = await pickOneLurker(guild, { lastPickedId: _lastLurkerId });
            lurker = picked;
        }

        if (!lurker) {
            return interaction.editReply('なりすまし対象が見つかりませんでした。');
        }

        // sticky: true が指定されたらこのlurkerで24時間固定
        if (stickyOpt === true) {
            setSticky(user.id, lurker.id);
        }

        // sticky未使用時のみ lastLurkerId を更新
        if (!getSticky(user.id)) {
            _lastLurkerId = lurker.id;
        }

        // ── Webhook取得 ──
        const targetChannel = channel.isThread() ? channel.parent : channel;
        let webhook = webhookCache.get(targetChannel.id);
        if (!webhook) {
            const webhooks = await targetChannel.fetchWebhooks().catch(() => null);
            webhook = webhooks?.find(wh => wh.owner?.id === client.user.id);
            if (!webhook) webhook = await targetChannel.createWebhook({ name: 'ImpProxy' });
            webhookCache.set(targetChannel.id, webhook);
        }

        // ── リプライ処理 ──
        const QUOTE_MAX = 17;
        const file      = options.getAttachment('file');
        const replyLink = options.getString('reply_link');
        let replyPrefix = '';
        if (replyLink) {
            const messageId  = replyLink.split('/').pop();
            const repliedMsg = await channel.messages.fetch(messageId).catch(() => null);
            if (repliedMsg) {
                let authorName;
                if (repliedMsg.webhookId) {
                    const { displayId } = extractUserIds(repliedMsg.content);
                    authorName = displayId ? `<@${displayId}>` : repliedMsg.author.username;
                } else {
                    authorName = `<@${repliedMsg.author.id}>`;
                }
                const cleanBody = [...(repliedMsg.content || '')]
                    .filter(c => !REVERSE_ZERO_WIDTH[c] && c !== ZERO_WIDTH_SEP)
                    .join('')
                    .replace(/\n/g, ' ')
                    .trim();
                const quoteLine = cleanBody.length > QUOTE_MAX
                    ? cleanBody.slice(0, QUOTE_MAX) + '…'
                    : cleanBody;
                replyPrefix = `**[Reply to](${replyLink}) : ${authorName}**\n`
                    + (quoteLine ? `> ${quoteLine}\n` : '');
            }
        }

        const hiddenPrefix = buildHiddenPrefix(user.id, lurker.id);

        await webhook.send({
            content:         hiddenPrefix + replyPrefix + content,
            username:        lurker.displayName || lurker.user.username,
            avatarURL:       lurker.user.displayAvatarURL({ dynamic: true }),
            files:           file ? [file.url] : [],
            allowedMentions: { parse: [], roles: [] },
            ...(channel.isThread() && { threadId: channel.id }),
        });

        const stickyStatus = getSticky(user.id) ? ' 📌sticky有効' : '';
        console.log(
            `[IMP] ${new Date().toISOString()} | executor=${user.id}` +
            ` | lurker=${lurker.id}(${lurker.user.tag})${stickyStatus}` +
            ` | ch=#${channel.name}(${channel.id}) | "${rawContent.slice(0, 80)}"`
        );

        await interaction.deleteReply().catch(() => {});

    } catch (e) {
        console.error('[Imp Error]:', e.message);
        if (interaction.deferred) {
            await interaction.editReply(`エラーが発生しました: ${e.message}`).catch(() => {});
        }
    }
}

module.exports = { handleImp };