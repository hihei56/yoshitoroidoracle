// transcribe.js — ボイスチャンネル文字起こしBot（Whisper使用）
//
// Discordの利用規約上、通話（音声）の内容を録音・保存するBotは参加者全員への
// 事前告知が必須。そのため本機能は「サーバー管理」権限を持つユーザーのみが起動・設定でき、
// （自動モードを含め）開始のたびに文字起こし対象のテキストチャンネルへ開始を明示し、
// 参加中のメンバー名もあわせて表示する。文字起こし結果もDM等ではなくそのチャンネルに公開投稿する。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ChannelType, PermissionsBitField, EmbedBuilder } = require('discord.js');
const {
    joinVoiceChannel, entersState, VoiceConnectionStatus, EndBehaviorType,
} = require('@discordjs/voice');
const prism = require('prism-media');
const { OpenAI } = require('openai');
const { getSettings, saveSettings } = require('./config');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SAMPLE_RATE   = 48000;
const CHANNELS      = 2;
const SILENCE_MS    = 1200; // これだけ無音が続いたら発話の区切りとみなす
const MIN_AUDIO_MS  = 500;  // これより短い発話はノイズとして無視

const guildStates = new Map(); // guildId -> { connection, receiver, textChannel, subscribed:Set<userId> }

function getTranscribeSettings() {
    const s = getSettings();
    return { autoJoin: !!s.transcribeAutoJoin, channelId: s.transcribeChannelId ?? null };
}

function buildWavBuffer(pcmBuffer) {
    const byteRate = SAMPLE_RATE * CHANNELS * 2;
    const blockAlign = CHANNELS * 2;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmBuffer.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(CHANNELS, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmBuffer.length, 40);
    return Buffer.concat([header, pcmBuffer]);
}

function cleanupGuild(guildId) {
    const state = guildStates.get(guildId);
    if (!state) return;
    try { state.receiver.speaking.removeAllListeners('start'); } catch {}
    try { state.connection.destroy(); } catch {}
    guildStates.delete(guildId);
}

async function transcribeAndPost(state, displayName, pcmChunks) {
    const pcmBuffer = Buffer.concat(pcmChunks);
    const durationMs = (pcmBuffer.length / (SAMPLE_RATE * CHANNELS * 2)) * 1000;
    if (durationMs < MIN_AUDIO_MS) return;

    const tmpFile = path.join(os.tmpdir(), `transcribe_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
    try {
        fs.writeFileSync(tmpFile, buildWavBuffer(pcmBuffer));

        const result = await openai.audio.transcriptions.create({
            file: fs.createReadStream(tmpFile),
            model: 'whisper-1',
            language: 'ja',
        });

        const text = (result.text || '').trim();
        if (!text) return;

        await state.textChannel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setDescription(`🎙️ **${displayName}**：${text}`)
                    .setTimestamp(),
            ],
        }).catch(() => {});
    } catch (e) {
        console.error('[Transcribe] Whisper変換エラー:', e.message);
    } finally {
        fs.unlink(tmpFile, () => {});
    }
}

function subscribeToUser(state, userId, displayName) {
    if (state.subscribed.has(userId)) return;
    state.subscribed.add(userId);

    const opusStream = state.receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_MS },
    });
    const decoder = new prism.opus.Decoder({ rate: SAMPLE_RATE, channels: CHANNELS, frameSize: 960 });
    const chunks = [];

    opusStream.on('error', () => {});
    decoder.on('error', e => console.error('[Transcribe] デコードエラー:', e.message));
    decoder.on('data', chunk => chunks.push(chunk));
    decoder.on('close', () => {
        state.subscribed.delete(userId);
        transcribeAndPost(state, displayName, chunks);
    });

    opusStream.pipe(decoder);
}

// VCへの参加と文字起こし開始処理（手動 /transcribe-join と自動参加の両方から使う共通処理）
async function startTranscribing(guild, voiceChannel, textChannel, { announcePrefix = '🎙️ **文字起こしを開始しました**' } = {}) {
    if (!process.env.OPENAI_API_KEY) return { ok: false, reason: 'OPENAI_API_KEY が設定されていません。' };

    const me = guild.members.me;
    if (!me?.permissionsIn(voiceChannel).has(PermissionsBitField.Flags.Connect)) {
        return { ok: false, reason: 'Botに「接続」権限がありません。' };
    }

    cleanupGuild(guild.id);

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: true,
    });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    } catch (e) {
        connection.destroy();
        return { ok: false, reason: 'ボイスチャンネルへの接続がタイムアウトしました。' };
    }

    const state = {
        connection,
        receiver: connection.receiver,
        textChannel,
        subscribed: new Set(),
    };
    guildStates.set(guild.id, state);

    state.receiver.speaking.on('start', userId => {
        const member = guild.members.cache.get(userId);
        if (!member || member.user.bot) return;
        subscribeToUser(state, userId, member.displayName);
    });

    connection.on(VoiceConnectionStatus.Disconnected, () => cleanupGuild(guild.id));

    const memberNames = voiceChannel.members
        .filter(m => !m.user.bot)
        .map(m => m.displayName)
        .join('、') || 'なし';

    await textChannel.send(
        `${announcePrefix}\n` +
        `${voiceChannel} での発言をこのチャンネルに文字起こしします。\n` +
        `現在の参加者: ${memberNames}\n` +
        `⚠️ 通話参加者には文字起こしされることを伝えておいてください。`
    ).catch(() => {});

    return { ok: true };
}

async function handleTranscribeJoin(interaction) {
    try {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        }
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({ content: '❌ このコマンドを使用するには「サーバー管理」権限が必要です。', ephemeral: true });
        }

        const voiceChannel = interaction.member.voice?.channel;
        if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
            return interaction.reply({ content: '❌ 先にボイスチャンネルに参加してください。', ephemeral: true });
        }

        await interaction.deferReply();
        const result = await startTranscribing(interaction.guild, voiceChannel, interaction.channel);
        if (!result.ok) {
            return interaction.editReply({ content: `❌ ${result.reason}` });
        }
        return interaction.editReply({ content: '✅ 文字起こしを開始しました。' });
    } catch (e) {
        console.error('[Transcribe] join エラー:', e);
        cleanupGuild(interaction.guildId);
        return interaction.reply({ content: '❌ ボイスチャンネルへの参加に失敗しました。', ephemeral: true }).catch(() => {});
    }
}

async function handleTranscribeLeave(interaction) {
    try {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        }
        if (!guildStates.has(interaction.guild.id)) {
            return interaction.reply({ content: 'ℹ️ 文字起こしは実行されていません。', ephemeral: true });
        }
        cleanupGuild(interaction.guild.id);
        return interaction.reply({ content: '👋 文字起こしを終了し、ボイスチャンネルから退出しました。' });
    } catch (e) {
        console.error('[Transcribe] leave エラー:', e);
        return interaction.reply({ content: '❌ 処理中にエラーが発生しました。', ephemeral: true }).catch(() => {});
    }
}

async function handleTranscribeAuto(interaction) {
    try {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        }
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({ content: '❌ このコマンドを使用するには「サーバー管理」権限が必要です。', ephemeral: true });
        }

        const enabled = interaction.options.getBoolean('enabled');
        const settings = getSettings();
        settings.transcribeAutoJoin = enabled;
        if (enabled) settings.transcribeChannelId = interaction.channel.id;
        saveSettings(settings);

        if (!enabled) {
            return interaction.reply({ content: '🛑 自動文字起こしをオフにしました。' });
        }
        return interaction.reply({
            content:
                `✅ **自動文字起こしをオンにしました**\n` +
                `誰かがボイスチャンネルに参加すると自動でBotが参加し、発言を ${interaction.channel} に文字起こしします。\n` +
                `全員が退出すると自動で終了します。\n` +
                `⚠️ 通話参加者には文字起こしされることを伝えておいてください。`,
        });
    } catch (e) {
        console.error('[Transcribe] auto エラー:', e);
        return interaction.reply({ content: '❌ 処理中にエラーが発生しました。', ephemeral: true }).catch(() => {});
    }
}

// voiceStateUpdateのたびに呼ばれる。自動モードがオンなら、人がVCに入った時点で自動参加し、
// 誰もいなくなったら自動退出する。
async function handleTranscribeVoiceState(oldState, newState) {
    try {
        const { autoJoin, channelId } = getTranscribeSettings();
        if (!autoJoin) return;

        const guild = newState.guild;
        const joined = newState.channelId && newState.channelId !== oldState.channelId;

        if (joined && !newState.member?.user.bot && !guildStates.has(guild.id)) {
            const voiceChannel = newState.channel;
            if (!voiceChannel) return;

            const textChannel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
            if (!textChannel) return;

            await startTranscribing(guild, voiceChannel, textChannel, { announcePrefix: '🎙️ **自動文字起こしを開始しました**' });
            return;
        }

        const state = guildStates.get(guild.id);
        if (state) {
            const currentChannelId = state.connection.joinConfig.channelId;
            const vc = guild.channels.cache.get(currentChannelId);
            const humansLeft = vc?.members.filter(m => !m.user.bot).size ?? 0;
            if (humansLeft === 0) cleanupGuild(guild.id);
        }
    } catch (e) {
        console.error('[Transcribe] 自動参加処理エラー:', e.message);
    }
}

module.exports = {
    handleTranscribeJoin,
    handleTranscribeLeave,
    handleTranscribeAuto,
    handleTranscribeVoiceState,
};
