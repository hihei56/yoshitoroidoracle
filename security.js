// security.js — 危険権限監視 + permlist コマンド
const { EmbedBuilder, Events, PermissionsBitField } = require('discord.js');

const OWNER_ID      = '1092367375355088947';
const LOG_CHANNEL_ID = '1476943641242239056';

// 監視対象の危険権限
const DANGEROUS_PERMS = [
    { flag: PermissionsBitField.Flags.Administrator,       label: 'Administrator'       },
    { flag: PermissionsBitField.Flags.ManageGuild,         label: 'ManageGuild'         },
    { flag: PermissionsBitField.Flags.ManageRoles,         label: 'ManageRoles'         },
    { flag: PermissionsBitField.Flags.ManageChannels,      label: 'ManageChannels'      },
    { flag: PermissionsBitField.Flags.BanMembers,          label: 'BanMembers'          },
    { flag: PermissionsBitField.Flags.KickMembers,         label: 'KickMembers'         },
    { flag: PermissionsBitField.Flags.ManageWebhooks,      label: 'ManageWebhooks'      },
    { flag: PermissionsBitField.Flags.ManageMessages,      label: 'ManageMessages'      },
    { flag: PermissionsBitField.Flags.MentionEveryone,     label: 'MentionEveryone'     },
    { flag: PermissionsBitField.Flags.ManageNicknames,     label: 'ManageNicknames'     },
];

function getDangerousFlags(permissionsBitfield) {
    return DANGEROUS_PERMS
        .filter(p => permissionsBitfield.has(p.flag))
        .map(p => p.label);
}

/* =========================
   📢 通知送信
========================= */
async function sendAlert(client, { title, description, fields, color = 0xFF0000 }) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .addFields(fields)
        .setColor(color)
        .setTimestamp();

    // ログチャンネル
    try {
        const logCh = await client.channels.fetch(LOG_CHANNEL_ID);
        if (logCh) await logCh.send({ embeds: [embed] });
    } catch (e) {
        console.error('[Security] ログチャンネル送信失敗:', e.message);
    }

    // オーナーにDM
    try {
        const owner = await client.users.fetch(OWNER_ID);
        if (owner) await owner.send({ embeds: [embed] });
    } catch (e) {
        console.error('[Security] DM送信失敗:', e.message);
    }
}

/* =========================
   👤 メンバーのロール変更監視
   新しく付与されたロールに危険権限があれば通知
========================= */
async function handleMemberUpdate(oldMember, newMember) {
    const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    if (addedRoles.size === 0) return;

    for (const [, role] of addedRoles) {
        const dangerous = getDangerousFlags(role.permissions);
        if (dangerous.length === 0) continue;

        console.warn(`[Security] 危険権限付与: ${newMember.user.tag} → ${role.name} [${dangerous.join(', ')}]`);

        await sendAlert(newMember.client, {
            title:       '⚠️ 危険権限の付与を検知',
            description: `<@${newMember.id}> に危険なロールが付与されました。`,
            fields: [
                { name: 'ユーザー',   value: `<@${newMember.id}> (${newMember.user.tag})`, inline: true  },
                { name: 'ロール',     value: `<@&${role.id}> (${role.name})`,               inline: true  },
                { name: '危険権限',   value: dangerous.map(p => `\`${p}\``).join(', '),     inline: false },
            ],
        });
    }
}

/* =========================
   🔧 ロール権限変更監視
   既存ロールに危険権限が追加された場合に通知
========================= */
async function handleRoleUpdate(oldRole, newRole) {
    const oldDangerous = getDangerousFlags(oldRole.permissions);
    const newDangerous = getDangerousFlags(newRole.permissions);

    // 新たに追加された危険権限のみ抽出
    const added = newDangerous.filter(p => !oldDangerous.includes(p));
    if (added.length === 0) return;

    console.warn(`[Security] ロール権限変更: ${newRole.name} に [${added.join(', ')}] 追加`);

    // このロールを持つメンバーを列挙
    const guild   = newRole.guild;
    const members = guild.members.cache.filter(m => m.roles.cache.has(newRole.id));
    const affected = members.size > 0
        ? [...members.values()].map(m => `<@${m.id}>`).join(', ')
        : 'なし';

    await sendAlert(newRole.client, {
        title:       '⚠️ ロール権限の変更を検知',
        description: `ロール **${newRole.name}** に危険な権限が追加されました。`,
        fields: [
            { name: 'ロール',         value: `<@&${newRole.id}> (${newRole.name})`,     inline: true  },
            { name: '追加された権限', value: added.map(p => `\`${p}\``).join(', '),     inline: true  },
            { name: '影響メンバー',   value: affected.slice(0, 1000),                   inline: false },
        ],
        color: 0xFF6600,
    });
}

/* =========================
   📋 /permlist コマンド
   危険権限を持つロール・メンバーを一覧表示
========================= */
async function handlePermList(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    await guild.members.fetch();

    // 危険権限を持つロールを収集
    const dangerousRoles = guild.roles.cache
        .filter(r => getDangerousFlags(r.permissions).length > 0)
        .sort((a, b) => b.position - a.position);

    if (dangerousRoles.size === 0) {
        return interaction.editReply('危険権限を持つロールは見つかりませんでした。');
    }

    const embeds = [];
    let currentFields = [];

    for (const [, role] of dangerousRoles) {
        const dangerous = getDangerousFlags(role.permissions);
        const members   = guild.members.cache.filter(m => m.roles.cache.has(role.id));
        const memberList = members.size > 0
            ? [...members.values()].map(m => `<@${m.id}>`).join(' ')
            : 'なし';

        currentFields.push({
            name:   `<@&${role.id}> — ${role.name}`,
            value:  `**権限:** ${dangerous.map(p => `\`${p}\``).join(', ')}\n**所持者:** ${memberList.slice(0, 500)}`,
            inline: false,
        });

        // Embedのフィールド上限（25個）に近づいたら新しいEmbedに分割
        if (currentFields.length >= 10) {
            embeds.push(
                new EmbedBuilder()
                    .setTitle(embeds.length === 0 ? '🔐 危険権限 保持者一覧' : '🔐 危険権限 保持者一覧（続き）')
                    .addFields(currentFields)
                    .setColor(0xFEE75C)
                    .setTimestamp()
            );
            currentFields = [];
        }
    }

    if (currentFields.length > 0) {
        embeds.push(
            new EmbedBuilder()
                .setTitle(embeds.length === 0 ? '🔐 危険権限 保持者一覧' : '🔐 危険権限 保持者一覧（続き）')
                .addFields(currentFields)
                .setColor(0xFEE75C)
                .setTimestamp()
        );
    }

    await interaction.editReply({ embeds });
}

/* =========================
   🔌 イベント登録
========================= */
function initSecurity(client) {
    client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
        handleMemberUpdate(oldMember, newMember).catch(e =>
            console.error('[Security] MemberUpdate エラー:', e.message)
        );
    });

    client.on(Events.GuildRoleUpdate, (oldRole, newRole) => {
        handleRoleUpdate(oldRole, newRole).catch(e =>
            console.error('[Security] RoleUpdate エラー:', e.message)
        );
    });

    console.log('[Security] ✅ 危険権限監視 開始');
}

module.exports = { initSecurity, handlePermList };
