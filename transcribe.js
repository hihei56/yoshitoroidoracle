// transcribe.js — ボイスチャンネル文字起こしBot（Whisper使用）
//
// Discordの利用規約上、通話（音声）の内容を録音・保存するBotは参加者全員への
// 事前告知が必須。そのため本機能は「サーバー管理」権限を持つユーザーのみが起動でき、
// 起動時に文字起こし対象のテキストチャンネルへ開始を明示し、参加中のメンバー名も
// あわせて表示する。文字起こし結果もDM等ではなくそのチャンネルに公開投稿する。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ChannelType, PermissionsBitField, EmbedBuilder } = require('discord.js');
const {
    joinVoiceChannel, entersState, VoiceConnectionStatus, EndBehaviorType,
} = require('@discordjs/voice');
const prism = require('prism-media');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SAMPLE_RATE   = 48000;
const CHANNELS      = 2;
const SILENCE_MS    = 1200; // これだけ無音が続いたら発話の区切りとみなす
const MIN_AUDIO_MS  = 500;  // これより短い発話はノイズとして無視

const guildStates = new Map(); // guildId -> { connection, receiver, textChannel, subscribed:Set<userId> }

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

async function handleTranscribeJoin(interaction) {
    try {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        }
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({ content: '❌ このコマンドを使用するには「サーバー管理」権限が必要です。', ephemeral: true });
        }
        if (!process.env.OPENAI_API_KEY) {
            return interaction.reply({ content: '❌ OPENAI_API_KEY が設定されていないため文字起こしを利用できません。', ephemeral: true });
        }

        const voiceChannel = interaction.member.voice?.channel;
        if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
            return interaction.reply({ content: '❌ 先にボイスチャンネルに参加してください。', ephemeral: true });
        }

        const me = interaction.guild.members.me;
        if (!me?.permissionsIn(voiceChannel).has(PermissionsBitField.Flags.Connect)) {
            return interaction.reply({ content: '❌ Botに「接続」権限が必要です。', ephemeral: true });
        }

        cleanupGuild(interaction.guild.id);

        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: interaction.guild.id,
            adapterCreator: interaction.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: true,
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

        const state = {
            connection,
            receiver: connection.receiver,
            textChannel: interaction.channel,
            subscribed: new Set(),
        };
        guildStates.set(interaction.guild.id, state);

        state.receiver.speaking.on('start', userId => {
            const member = interaction.guild.members.cache.get(userId);
            if (!member || member.user.bot) return;
            subscribeToUser(state, userId, member.displayName);
        });

        connection.on(VoiceConnectionStatus.Disconnected, () => cleanupGuild(interaction.guild.id));

        const memberNames = voiceChannel.members
            .filter(m => !m.user.bot)
            .map(m => m.displayName)
            .join('、') || 'なし';

        return interaction.reply({
            content:
                `🎙️ **文字起こしを開始しました**\n` +
                `${voiceChannel} での発言をこのチャンネルに文字起こしします。\n` +
                `現在の参加者: ${memberNames}\n` +
                `⚠️ 通話参加者全員に文字起こし中であることを伝えてから利用してください。`,
        });
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

module.exports = { handleTranscribeJoin, handleTranscribeLeave };
