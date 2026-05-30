// invite_filter.js — NGサーバー招待リンク自動削除
const { EmbedBuilder } = require('discord.js');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const NG_SERVERS_PATH = resolveDataPath('ng_servers.json');
ensureDir(NG_SERVERS_PATH);

const LOG_CHANNEL_ID = '1476943641242239056';

// 検閲スキップロール（moderator.js と合わせる）
const EXEMPT_ROLES = [
    '1486178659130933278',
    '1477024387524857988',
];

const INVITE_REGEX = /discord(?:app)?\.(?:gg|com)(?:\/invite)?\/([A-Za-z0-9-]{2,32})/g;

// 解決済みinviteのキャッシュ（再fetch削減）
const resolvedCache = new Map(); // inviteCode → guildId | 'INVALID'

function getNGList() {
    return readJson(NG_SERVERS_PATH, []);
}

function saveNGList(list) {
    writeJson(NG_SERVERS_PATH, list);
}

/* =========================
   メッセージ監視
========================= */
async function handleInviteFilter(message, client) {
    if (!message.guild) return;

    // 除外ロール
    const member = message.member;
    if (member && EXEMPT_ROLES.some(id => member.roles.cache.has(id))) return;

    const content = message.content;
    const codes = [...content.matchAll(INVITE_REGEX)].map(m => m[1]);
    if (codes.length === 0) return;

    const ngList = getNGList();
    if (ngList.length === 0) return;

    for (const code of codes) {
        const guildId = await resolveInvite(client, code);
        if (!guildId || guildId === 'INVALID') continue;
        if (!ngList.includes(guildId)) continue;

        // NGサーバーの招待を検出 → 削除
        try {
            await message.delete();
        } catch (e) {
            console.error('[InviteFilter] メッセージ削除失敗:', e.message);
            return;
        }

        console.warn(`[InviteFilter] NGサーバー招待を削除: guild=${guildId} code=${code} user=${message.author.tag}`);

        // ログ通知
        try {
            const logCh = await client.channels.fetch(LOG_CHANNEL_ID);
            if (!logCh) return;

            const embed = new EmbedBuilder()
                .setTitle('🚫 NGサーバー招待リンクを削除')
                .setColor(0xED4245)
                .addFields(
                    { name: '投稿者',       value: `<@${message.author.id}> (${message.author.tag})`, inline: true  },
                    { name: 'チャンネル',   value: `<#${message.channelId}>`,                          inline: true  },
                    { name: 'NGサーバーID', value: `\`${guildId}\``,                                   inline: false },
                    { name: '招待コード',   value: `\`${code}\``,                                      inline: false },
                )
                .setTimestamp();

            await logCh.send({ embeds: [embed] });
        } catch (e) {
            console.error('[InviteFilter] ログ送信失敗:', e.message);
        }

        return; // 1件でも引っかかれば処理終了
    }
}

async function resolveInvite(client, code) {
    if (resolvedCache.has(code)) return resolvedCache.get(code);

    try {
        const invite = await client.fetchInvite(code);
        const guildId = invite.guild?.id ?? null;
        if (guildId) resolvedCache.set(code, guildId);
        return guildId;
    } catch {
        resolvedCache.set(code, 'INVALID');
        return 'INVALID';
    }
}

/* =========================
   /admin ngserver コマンド
========================= */
async function handleNGServer(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
        const list = getNGList();
        if (list.length === 0) {
            return interaction.reply({ content: 'NGサーバーリストは空です。', ephemeral: true });
        }
        const embed = new EmbedBuilder()
            .setTitle('🚫 NGサーバーリスト')
            .setColor(0xED4245)
            .setDescription(list.map((id, i) => `${i + 1}. \`${id}\``).join('\n'))
            .setFooter({ text: `${list.length}件` })
            .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const serverId = interaction.options.getString('server_id').trim();
    if (!/^\d{17,20}$/.test(serverId)) {
        return interaction.reply({ content: '❌ サーバーIDは17〜20桁の数字で入力してください。', ephemeral: true });
    }

    const list = getNGList();

    if (sub === 'add') {
        if (list.includes(serverId)) {
            return interaction.reply({ content: `⚠️ \`${serverId}\` は既にNGリストに登録済みです。`, ephemeral: true });
        }
        list.push(serverId);
        saveNGList(list);
        // キャッシュをクリアして次回再解決させる
        for (const [code, id] of resolvedCache) {
            if (id === serverId) resolvedCache.delete(code);
        }
        return interaction.reply({ content: `✅ \`${serverId}\` をNGリストに追加しました。`, ephemeral: true });
    }

    if (sub === 'remove') {
        const idx = list.indexOf(serverId);
        if (idx === -1) {
            return interaction.reply({ content: `⚠️ \`${serverId}\` はNGリストに存在しません。`, ephemeral: true });
        }
        list.splice(idx, 1);
        saveNGList(list);
        return interaction.reply({ content: `✅ \`${serverId}\` をNGリストから削除しました。`, ephemeral: true });
    }
}

module.exports = { handleInviteFilter, handleNGServer };
