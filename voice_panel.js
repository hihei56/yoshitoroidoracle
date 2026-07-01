// voice_panel.js — 一時ボイスチャンネル パネル
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, UserSelectMenuBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelType,
} = require('discord.js');
const { resolveDataPath, ensureDir, readJson, writeJson } = require('./dataPath');

const SETTINGS_FILE = resolveDataPath('voice_panel_settings.json');
const OWNERS_FILE   = resolveDataPath('voice_panel_owners.json');
const PROFILES_FILE = resolveDataPath('voice_panel_profiles.json');
ensureDir(SETTINGS_FILE);
ensureDir(OWNERS_FILE);
ensureDir(PROFILES_FILE);

function getVPSettings() {
    return readJson(SETTINGS_FILE, {
        joinChannelId: null, categoryId: null,
        notifyChannelId: null, notifyRoleId: null, notifyMinutes: 5,
    });
}
function saveVPSettings(settings) {
    writeJson(SETTINGS_FILE, settings);
}

function getOwners() {
    return readJson(OWNERS_FILE, {});
}
function saveOwners(owners) {
    writeJson(OWNERS_FILE, owners);
}
function getTempOwner(channelId) {
    return getOwners()[channelId] ?? null;
}
function setTempOwner(channelId, userId) {
    const owners = getOwners();
    owners[channelId] = userId;
    saveOwners(owners);
}
function deleteTempOwner(channelId) {
    const owners = getOwners();
    delete owners[channelId];
    saveOwners(owners);
}

/* ===== 部屋プロフィール（オーナー単位で永続化・管理者のみ変更） ===== */
function getProfiles() {
    return readJson(PROFILES_FILE, {});
}
function saveProfiles(profiles) {
    writeJson(PROFILES_FILE, profiles);
}
function getRoomProfile(ownerId) {
    const profiles = getProfiles();
    return {
        bannedUserIds: [], bannedRoleIds: [],
        defaultUserLimit: null, defaultLocked: false, nsfw: false,
        ...profiles[ownerId],
    };
}
function saveRoomProfile(ownerId, profile) {
    const profiles = getProfiles();
    profiles[ownerId] = profile;
    saveProfiles(profiles);
}

// そのオーナーが現在保有している一時チャンネルIDを探す
function findActiveChannelId(ownerId) {
    const owners = getOwners();
    return Object.keys(owners).find(chId => owners[chId] === ownerId) ?? null;
}

// 出禁対象かどうか（オーナー本人は常に除外＝自分のロール出禁で締め出されない）
function isBanned(member, profile, ownerId) {
    if (member.id === ownerId) return false;
    if (profile.bannedUserIds.includes(member.id)) return true;
    return profile.bannedRoleIds.some(rid => member.roles.cache.has(rid));
}

// オーナーは常にConnect/ViewChannelを明示許可し、出禁ユーザー/ロールを個別に拒否する。
// .edit()/.delete()は対象IDだけを操作するため、カテゴリ由来のオーバーライドや
// ロック/非表示状態など、他のオーバーライドを巻き込んで消すことがない。
async function applyBanOverwrites(channel, ownerId, profile) {
    await channel.permissionOverwrites.edit(ownerId, { Connect: true, ViewChannel: true }).catch(() => {});
    for (const uid of profile.bannedUserIds) {
        if (uid === ownerId) continue;
        await channel.permissionOverwrites.edit(uid, { Connect: false, ViewChannel: false }).catch(() => {});
    }
    for (const rid of profile.bannedRoleIds) {
        await channel.permissionOverwrites.edit(rid, { Connect: false, ViewChannel: false }).catch(() => {});
    }
}

// 管理者が出禁設定を変更した際、既に存在する一時チャンネルへ即時反映する
async function applyProfileToActiveChannel(guild, ownerId, { unbannedUserId, unbannedRoleId } = {}) {
    const channelId = findActiveChannelId(ownerId);
    if (!channelId) return;
    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;

    if (unbannedUserId) await channel.permissionOverwrites.delete(unbannedUserId).catch(() => {});
    if (unbannedRoleId) await channel.permissionOverwrites.delete(unbannedRoleId).catch(() => {});

    const profile = getRoomProfile(ownerId);
    await applyBanOverwrites(channel, ownerId, profile);

    // 現在接続中の出禁対象を切断
    for (const member of channel.members.values()) {
        if (isBanned(member, profile, ownerId)) await member.voice.disconnect().catch(() => {});
    }
}

const USER_LIMIT_CHOICES = [0, 1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 99];

/* ===== パネル embed & コンポーネント ===== */
function buildPanelEmbed(guild) {
    return new EmbedBuilder()
        .setAuthor({ name: '一時ボイスチャンネル パネル', iconURL: guild.client.user.displayAvatarURL() })
        .setDescription('*ボタンを押して、自分の一時ボイスチャンネルを操作できます。*')
        .setColor(0x5865F2)
        .setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined })
        .setTimestamp();
}

function buildPanelComponents() {
    const rowOne = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vcpanel_lock').setLabel('ロック').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vcpanel_unlock').setLabel('ロック解除').setEmoji('🔓').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vcpanel_hide').setLabel('非表示').setEmoji('🙈').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vcpanel_unhide').setLabel('表示').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
    );
    const rowTwo = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vcpanel_mute').setLabel('全員ミュート').setEmoji('🔇').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vcpanel_unmute').setLabel('全員ミュート解除').setEmoji('🔊').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vcpanel_userlimit_modal').setLabel('人数上限を指定').setEmoji('🔢').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vcpanel_disconnect').setLabel('全員切断').setEmoji('📞').setStyle(ButtonStyle.Danger),
    );
    const rowThree = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vcpanel_usersmanager').setLabel('ユーザー管理').setEmoji('👥').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vcpanel_rename').setLabel('名前を変更').setEmoji('📝').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('vcpanel_delete').setLabel('チャンネルを削除').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    );
    const rowFour = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('vcpanel_userlimit')
            .setPlaceholder('人数制限を選択')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(USER_LIMIT_CHOICES.map(n => ({ label: n === 0 ? '無制限' : `${n}人`, value: `${n}` }))),
    );
    return [rowOne, rowTwo, rowThree, rowFour];
}

/* ===== /voicepanel コマンド ===== */
async function handleVoicePanel(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub   = interaction.options.getSubcommand();

    if (group === 'roomconfig') {
        const owner   = interaction.options.getUser('owner');
        const profile = getRoomProfile(owner.id);

        if (sub === 'ban' || sub === 'unban') {
            const targetUser = interaction.options.getUser('user');
            const targetRole = interaction.options.getRole('role');
            if (!targetUser && !targetRole) {
                return interaction.reply({ content: '❌ user または role のどちらかを指定してください。', ephemeral: true });
            }

            if (sub === 'ban') {
                if (targetUser && !profile.bannedUserIds.includes(targetUser.id)) profile.bannedUserIds.push(targetUser.id);
                if (targetRole && !profile.bannedRoleIds.includes(targetRole.id)) profile.bannedRoleIds.push(targetRole.id);
                saveRoomProfile(owner.id, profile);
                await applyProfileToActiveChannel(interaction.guild, owner.id);
                return interaction.reply({
                    content: `✅ ${owner} の部屋から ${targetUser ?? targetRole} を出禁にしました。`,
                    ephemeral: true,
                });
            }

            if (targetUser) profile.bannedUserIds = profile.bannedUserIds.filter(id => id !== targetUser.id);
            if (targetRole) profile.bannedRoleIds = profile.bannedRoleIds.filter(id => id !== targetRole.id);
            saveRoomProfile(owner.id, profile);
            await applyProfileToActiveChannel(interaction.guild, owner.id, {
                unbannedUserId: targetUser?.id, unbannedRoleId: targetRole?.id,
            });
            return interaction.reply({
                content: `✅ ${owner} の部屋の出禁を解除しました（${targetUser ?? targetRole}）。`,
                ephemeral: true,
            });
        }

        if (sub === 'defaults') {
            const limit  = interaction.options.getInteger('limit');
            const locked = interaction.options.getBoolean('locked');
            const nsfw   = interaction.options.getBoolean('nsfw');
            if (limit !== null)  profile.defaultUserLimit = limit;
            if (locked !== null) profile.defaultLocked    = locked;
            if (nsfw !== null)   profile.nsfw             = nsfw;
            saveRoomProfile(owner.id, profile);
            return interaction.reply({ content: `✅ ${owner} の部屋のデフォルト設定を更新しました。`, ephemeral: true });
        }

        if (sub === 'show') {
            return interaction.reply({
                content: [
                    `📋 対象: ${owner}`,
                    `📋 出禁ユーザー: ${profile.bannedUserIds.length ? profile.bannedUserIds.map(id => `<@${id}>`).join(' ') : 'なし'}`,
                    `📋 出禁ロール: ${profile.bannedRoleIds.length ? profile.bannedRoleIds.map(id => `<@&${id}>`).join(' ') : 'なし'}`,
                    `📋 デフォルト人数制限: ${profile.defaultUserLimit ?? '未設定（参加用チャンネルと同じ）'}`,
                    `📋 デフォルトロック: ${profile.defaultLocked ? '有効' : '無効'}`,
                    `📋 NSFW: ${profile.nsfw ? '有効' : '無効'}`,
                ].join('\n'),
                ephemeral: true,
            });
        }
        return;
    }

    if (sub === 'setup') {
        const joinChannel = interaction.options.getChannel('join_channel');
        const category    = interaction.options.getChannel('category');
        const settings = getVPSettings();
        settings.joinChannelId = joinChannel.id;
        settings.categoryId    = category?.id ?? null;
        saveVPSettings(settings);
        return interaction.reply({
            content: `✅ 参加用チャンネルを ${joinChannel} に設定しました。${category ? `（作成先カテゴリ: ${category}）` : ''}`,
            ephemeral: true,
        });
    }

    if (sub === 'panel') {
        const embed = buildPanelEmbed(interaction.guild);
        const components = buildPanelComponents();
        await interaction.channel.send({ embeds: [embed], components });
        return interaction.reply({ content: '✅ パネルを送信しました。', ephemeral: true });
    }

    if (sub === 'notify') {
        const notifyChannel = interaction.options.getChannel('channel');
        const role          = interaction.options.getRole('role');
        const minutes       = interaction.options.getInteger('minutes') ?? 5;
        const settings = getVPSettings();
        settings.notifyChannelId = notifyChannel.id;
        settings.notifyRoleId    = role?.id ?? null;
        settings.notifyMinutes   = minutes;
        saveVPSettings(settings);
        return interaction.reply({
            content: `✅ 一時ボイスチャンネルの通話が **${minutes}分** 継続した場合、${notifyChannel} に${role ? `${role} をメンションして` : ''}通知します。`,
            ephemeral: true,
        });
    }

    if (sub === 'status') {
        const settings = getVPSettings();
        return interaction.reply({
            content: [
                `📋 参加用チャンネル: ${settings.joinChannelId ? `<#${settings.joinChannelId}>` : '未設定'}`,
                `📋 作成先カテゴリ: ${settings.categoryId ? `<#${settings.categoryId}>` : '参加用チャンネルと同じ'}`,
                `📋 通話通知チャンネル: ${settings.notifyChannelId ? `<#${settings.notifyChannelId}>` : '未設定'}`,
                `📋 通話通知ロール: ${settings.notifyRoleId ? `<@&${settings.notifyRoleId}>` : 'なし'}`,
                `📋 通話通知までの時間: ${settings.notifyMinutes ?? 5}分`,
            ].join('\n'),
            ephemeral: true,
        });
    }
}

/* ===== 通話継続通知 ===== */
const notifyTimers = new Map(); // channelId -> Timeout
const notifyWebhookCache = new Map(); // textChannelId -> Webhook

async function getNotifyWebhook(textChannel) {
    if (notifyWebhookCache.has(textChannel.id)) return notifyWebhookCache.get(textChannel.id);
    const hooks = await textChannel.fetchWebhooks();
    let hook = hooks.find(h => h.owner?.id === textChannel.client.user.id && h.token);
    if (!hook) hook = await textChannel.createWebhook({ name: '通話お知らせくん' });
    notifyWebhookCache.set(textChannel.id, hook);
    return hook;
}

function formatDateTimeJST(ts) {
    const d = new Date(ts + 9 * 60 * 60 * 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function scheduleCallNotify(channel, settings, ownerId, startedAt) {
    if (!settings.notifyChannelId) return;
    const minutes = settings.notifyMinutes ?? 5;
    const timer = setTimeout(async () => {
        notifyTimers.delete(channel.id);
        const current = channel.guild.channels.cache.get(channel.id);
        if (!current) return; // 通話は既に終了している
        if (current.members.filter(m => !m.user.bot).size === 0) return;

        const notifyChannel = await channel.guild.channels.fetch(settings.notifyChannelId).catch(() => null);
        if (!notifyChannel) return;
        const webhook = await getNotifyWebhook(notifyChannel).catch(() => null);
        if (!webhook) return;

        const owner = await channel.guild.members.fetch(ownerId).catch(() => null);
        const avatarURL = owner?.user.displayAvatarURL({ extension: 'png', size: 128 })
            ?? channel.client.user.displayAvatarURL({ extension: 'png', size: 128 });
        const roleMention = settings.notifyRoleId ? `<@&${settings.notifyRoleId}> ` : '';

        const embed = new EmbedBuilder()
            .setTitle('通話開始')
            .setColor(0xEB459E)
            .addFields(
                { name: 'チャンネル', value: current.name, inline: true },
                { name: '始めた人',   value: `${owner ? owner.displayName : '不明ユーザー'}さん`, inline: true },
                { name: '開始時間',   value: formatDateTimeJST(startedAt), inline: true },
            )
            .setThumbnail(avatarURL);

        await webhook.send({
            content: `${roleMention}通話開始しました。`,
            username: '通話お知らせくん',
            avatarURL,
            embeds: [embed],
            allowedMentions: { roles: settings.notifyRoleId ? [settings.notifyRoleId] : [] },
        }).catch(() => {});
    }, minutes * 60 * 1000);
    notifyTimers.set(channel.id, timer);
}

function cancelCallNotify(channelId) {
    const timer = notifyTimers.get(channelId);
    if (timer) {
        clearTimeout(timer);
        notifyTimers.delete(channelId);
    }
}

/* ===== 一時チャンネルの作成・削除 ===== */
async function handleVoicePanelVoiceState(oldState, newState) {
    const settings = getVPSettings();

    if (settings.joinChannelId && newState.channelId === settings.joinChannelId) {
        try {
            const profile = getRoomProfile(newState.member.id);
            const channel = await newState.guild.channels.create({
                name: `${newState.member.displayName}のチャンネル`,
                type: ChannelType.GuildVoice,
                parent: settings.categoryId || newState.channel.parentId,
                userLimit: profile.defaultUserLimit ?? (newState.channel.userLimit || 0),
                nsfw: profile.nsfw,
            });
            setTempOwner(channel.id, newState.member.id);

            await applyBanOverwrites(channel, newState.member.id, profile);
            if (profile.defaultLocked) {
                await channel.permissionOverwrites.edit(newState.guild.roles.everyone.id, { Connect: false }).catch(() => {});
            }

            await newState.member.voice.setChannel(channel).catch(() => {});
            scheduleCallNotify(channel, settings, newState.member.id, Date.now());
        } catch (e) {
            console.error('[VoicePanel] チャンネル作成エラー:', e);
        }
    }

    // 出禁対象が一時チャンネルに残っていたら切断（オーバーライド反映前の入室等への保険）
    if (newState.channelId && newState.member) {
        const roomOwnerId = getTempOwner(newState.channelId);
        if (roomOwnerId) {
            const profile = getRoomProfile(roomOwnerId);
            if (isBanned(newState.member, profile, roomOwnerId)) {
                await newState.member.voice.disconnect().catch(() => {});
            }
        }
    }

    if (oldState.channelId && oldState.channelId !== newState.channelId) {
        const ownerId = getTempOwner(oldState.channelId);
        if (ownerId) {
            const channel = oldState.guild.channels.cache.get(oldState.channelId);
            if (channel && channel.members.filter(m => !m.user.bot).size === 0) {
                await channel.delete().catch(() => {});
                deleteTempOwner(oldState.channelId);
                cancelCallNotify(oldState.channelId);
            }
        }
    }
}

/* ===== 所有者チェック ===== */
function verifyOwner(interaction) {
    const channel = interaction.member.voice.channel;
    if (!channel) return { error: '❌ 一時ボイスチャンネルに参加していません。参加用チャンネルから作成してください。' };
    if (getTempOwner(channel.id) !== interaction.user.id) {
        return { error: '❌ このチャンネルの所有者ではありません。' };
    }
    return { channel };
}

/* ===== ボタン ===== */
async function handleVoicePanelButton(interaction) {
    const { channel, error } = verifyOwner(interaction);
    if (error) return interaction.reply({ content: error, ephemeral: true });

    switch (interaction.customId) {
        case 'vcpanel_lock':
            await interaction.deferUpdate();
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { Connect: false }).catch(() => {});
            break;
        case 'vcpanel_unlock':
            await interaction.deferUpdate();
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { Connect: true }).catch(() => {});
            break;
        case 'vcpanel_hide':
            await interaction.deferUpdate();
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { ViewChannel: false }).catch(() => {});
            break;
        case 'vcpanel_unhide':
            await interaction.deferUpdate();
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { ViewChannel: true }).catch(() => {});
            break;
        case 'vcpanel_mute':
            await interaction.deferUpdate();
            for (const member of channel.members.values()) {
                if (member.id !== interaction.user.id) await member.voice.setMute(true).catch(() => {});
            }
            break;
        case 'vcpanel_unmute':
            await interaction.deferUpdate();
            for (const member of channel.members.values()) {
                if (member.id !== interaction.user.id) await member.voice.setMute(false).catch(() => {});
            }
            break;
        case 'vcpanel_disconnect':
            await interaction.deferUpdate();
            for (const member of channel.members.values()) {
                if (member.id !== interaction.user.id) await member.voice.disconnect().catch(() => {});
            }
            break;
        case 'vcpanel_delete':
            await interaction.deferUpdate();
            deleteTempOwner(channel.id);
            await channel.delete().catch(() => {});
            break;
        case 'vcpanel_rename': {
            const modal = new ModalBuilder().setCustomId('vcpanel_modal_rename').setTitle('チャンネル名を変更');
            const input = new TextInputBuilder()
                .setCustomId('vcpanel_name')
                .setLabel('新しいチャンネル名')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(50)
                .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            break;
        }
        case 'vcpanel_userlimit_modal': {
            const modal = new ModalBuilder().setCustomId('vcpanel_modal_userlimit').setTitle('人数上限を指定');
            const input = new TextInputBuilder()
                .setCustomId('vcpanel_number')
                .setLabel('人数上限（0で無制限、99まで）')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(2)
                .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            break;
        }
        case 'vcpanel_usersmanager': {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('vcpanel_um_mute').setLabel('ミュート').setEmoji('🔇').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('vcpanel_um_unmute').setLabel('ミュート解除').setEmoji('🔊').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('vcpanel_um_deafen').setLabel('スピーカーミュート').setEmoji('🔕').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('vcpanel_um_undeafen').setLabel('スピーカーミュート解除').setEmoji('🔔').setStyle(ButtonStyle.Secondary),
            );
            await interaction.reply({ components: [row], ephemeral: true });
            break;
        }
        case 'vcpanel_um_mute':
        case 'vcpanel_um_unmute':
        case 'vcpanel_um_deafen':
        case 'vcpanel_um_undeafen': {
            const action = interaction.customId.replace('vcpanel_um_', '');
            const row = new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId(`vcpanel_um_select_${action}`)
                    .setPlaceholder('ユーザーを選択')
                    .setMinValues(1)
                    .setMaxValues(1),
            );
            await interaction.reply({ components: [row], ephemeral: true });
            break;
        }
    }
}

/* ===== 人数制限セレクトメニュー ===== */
async function handleVoicePanelSelect(interaction) {
    const { channel, error } = verifyOwner(interaction);
    if (error) return interaction.reply({ content: error, ephemeral: true });
    await interaction.deferUpdate();
    await channel.setUserLimit(parseInt(interaction.values[0], 10)).catch(() => {});
}

/* ===== ユーザー管理セレクトメニュー ===== */
async function handleVoicePanelUserSelect(interaction) {
    const { channel, error } = verifyOwner(interaction);
    if (error) return interaction.reply({ content: error, ephemeral: true });
    await interaction.deferUpdate();

    const member = channel.members.get(interaction.values[0]);
    if (!member) return;

    const action = interaction.customId.replace('vcpanel_um_select_', '');
    if (action === 'mute')     await member.voice.setMute(true).catch(() => {});
    if (action === 'unmute')   await member.voice.setMute(false).catch(() => {});
    if (action === 'deafen')   await member.voice.setDeaf(true).catch(() => {});
    if (action === 'undeafen') await member.voice.setDeaf(false).catch(() => {});
}

/* ===== モーダル ===== */
async function handleVoicePanelModal(interaction) {
    const { channel, error } = verifyOwner(interaction);
    if (error) return interaction.reply({ content: error, ephemeral: true });

    if (interaction.customId === 'vcpanel_modal_rename') {
        const name = interaction.fields.getTextInputValue('vcpanel_name');
        await channel.setName(name).catch(() => {});
        return interaction.reply({ content: `🪄 チャンネル名を \`${name}\` に変更しました。`, ephemeral: true });
    }

    if (interaction.customId === 'vcpanel_modal_userlimit') {
        const num = parseInt(interaction.fields.getTextInputValue('vcpanel_number'), 10);
        if (Number.isNaN(num) || num < 0 || num > 99) {
            return interaction.reply({ content: '❌ 0〜99の数値を入力してください。', ephemeral: true });
        }
        await channel.setUserLimit(num).catch(() => {});
        return interaction.reply({ content: `🪄 人数上限を \`${num === 0 ? '無制限' : num}\` に変更しました。`, ephemeral: true });
    }
}

module.exports = {
    handleVoicePanel,
    handleVoicePanelVoiceState,
    handleVoicePanelButton,
    handleVoicePanelSelect,
    handleVoicePanelUserSelect,
    handleVoicePanelModal,
};
