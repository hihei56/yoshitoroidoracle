// clean.js — 条件指定によるメッセージ一括削除
// jagrosh/Vortex の CleanCmd (Apache-2.0) の設計を参考に、discord.js のスラッシュコマンド向けに再設計
const { PermissionsBitField } = require('discord.js');

const MAX_AGE_MS  = 13.5 * 24 * 60 * 60 * 1000; // Discordのbulk delete制限(14日)より少し手前で打ち切る
const FETCH_BATCH = 100;

function hasImage(message) {
    if ([...message.attachments.values()].some(a => a.contentType?.startsWith('image/'))) return true;
    if (message.embeds.some(e => e.image || e.video || e.thumbnail)) return true;
    return false;
}

async function handleClean(interaction) {
    try {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        }
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: '❌ このコマンドを使用するには「メッセージの管理」権限が必要です。', ephemeral: true });
        }
        const me = interaction.guild.members.me;
        const perms = me?.permissionsIn(interaction.channel);
        if (!perms?.has(PermissionsBitField.Flags.ManageMessages) || !perms?.has(PermissionsBitField.Flags.ReadMessageHistory)) {
            return interaction.reply({ content: '❌ Botに「メッセージの管理」「メッセージ履歴を読む」権限が必要です。', ephemeral: true });
        }

        const count    = interaction.options.getInteger('count') ?? 100;
        const user     = interaction.options.getUser('user');
        const bots     = interaction.options.getBoolean('bots') ?? false;
        const embeds   = interaction.options.getBoolean('embeds') ?? false;
        const links    = interaction.options.getBoolean('links') ?? false;
        const images   = interaction.options.getBoolean('images') ?? false;
        const contains = interaction.options.getString('contains')?.toLowerCase() ?? null;
        const regexStr = interaction.options.getString('regex') ?? null;

        let regex = null;
        if (regexStr) {
            try {
                regex = new RegExp(regexStr, 'i');
            } catch (e) {
                return interaction.reply({ content: `❌ 正規表現が不正です: ${e.message}`, ephemeral: true });
            }
        }

        const hasFilter = Boolean(user || bots || embeds || links || images || contains || regex);

        await interaction.deferReply({ ephemeral: true });

        // 履歴を取得（最大 count 件、14日制限を超えたら打ち切り）
        const earliest = Date.now() - MAX_AGE_MS;
        const collected = [];
        let before;
        let hitAgeLimit = false;

        while (collected.length < count) {
            const batchSize = Math.min(FETCH_BATCH, count - collected.length);
            const batch = await interaction.channel.messages.fetch({ limit: batchSize, ...(before && { before }) });
            if (batch.size === 0) break;

            for (const msg of batch.values()) {
                if (msg.createdTimestamp < earliest) { hitAgeLimit = true; break; }
                collected.push(msg);
            }
            if (hitAgeLimit) break;

            before = batch.last().id;
            if (batch.size < batchSize) break;
        }

        const toDelete = collected.filter(msg => {
            if (msg.pinned) return false;
            if (!hasFilter) return true;
            if (user && msg.author.id === user.id) return true;
            if (bots && msg.author.bot) return true;
            if (embeds && msg.embeds.length > 0) return true;
            if (links && /https?:\/\/\S+/i.test(msg.content)) return true;
            if (images && hasImage(msg)) return true;
            if (contains && msg.content.toLowerCase().includes(contains)) return true;
            if (regex && regex.test(msg.content)) return true;
            return false;
        });

        if (toDelete.length === 0) {
            return interaction.editReply({
                content: `ℹ️ 削除対象のメッセージがありませんでした。${hitAgeLimit ? '\n※14日以上前のメッセージは削除できません。' : ''}`,
            });
        }

        let deletedCount = 0;
        for (let i = 0; i < toDelete.length; i += FETCH_BATCH) {
            const chunk = toDelete.slice(i, i + FETCH_BATCH);
            try {
                if (chunk.length === 1) {
                    await chunk[0].delete();
                    deletedCount += 1;
                } else {
                    const deleted = await interaction.channel.bulkDelete(chunk, true);
                    deletedCount += deleted.size;
                }
            } catch (e) {
                console.error('[Clean] 削除エラー:', e.message);
            }
        }

        return interaction.editReply({
            content: `✅ **${deletedCount}件** のメッセージを削除しました。${hitAgeLimit ? '\n※14日以上前のメッセージは対象外です。' : ''}`,
        });
    } catch (e) {
        console.error('[Clean] エラー:', e);
        if (interaction.deferred) {
            return interaction.editReply({ content: '❌ 処理中にエラーが発生しました。' }).catch(() => {});
        }
        return interaction.reply({ content: '❌ 処理中にエラーが発生しました。', ephemeral: true }).catch(() => {});
    }
}

module.exports = { handleClean };
