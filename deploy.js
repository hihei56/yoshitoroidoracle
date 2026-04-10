require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
    // 1. ダイス勝負
    new SlashCommandBuilder()
        .setName('dice')
        .setDescription('1日1回のダイス勝負。当たると制限がかかる場合があります。'),

    // 2. JOKERシステム
    new SlashCommandBuilder()
        .setName('joker')
        .setDescription('JOKERを実行。一か八かの制裁を下します。'),

    // 3. メッセージ送信機能（代行）
    new SlashCommandBuilder()
        .setName('say')
        .setDescription('指定した内容をボットに喋らせます。')
        .addStringOption(option =>
            option.setName('content')
                .setDescription('メッセージ内容（必須）')
                .setRequired(true)
        )
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('添付画像')
        )
        .addStringOption(option =>
            option.setName('reply_link')
                .setDescription('返信先メッセージのリンク')
        )
        .addBooleanOption(option =>
            option.setName('tokumei')
                .setDescription('true にすると全弱者男性を代弁する匿名アカウントとして送信')
        ),

    // 4. 管理機能
    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('管理設定。サブコマンドを選択してください。')
        .addSubcommand(subcommand =>
            subcommand
                .setName('mod_skip')
                .setDescription('ユーザー/ロールを検閲除外に設定します。')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('追加か解除を選択')
                        .setRequired(true)
                        .addChoices(
                            { name: '追加', value: 'add' },
                            { name: '解除', value: 'remove' }
                        )
                )
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('対象のユーザー（ロールと併用可）')
                )
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('対象のロール（ユーザーと併用可）')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('say_deny')
                .setDescription('ユーザー/ロールのSay代行権限を管理します。')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('拒否か許可を選択')
                        .setRequired(true)
                        .addChoices(
                            { name: '拒否', value: 'deny' },
                            { name: '許可', value: 'allow' }
                        )
                )
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('対象のユーザー（ロールと併用可）')
                )
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('対象のロール（ユーザーと併用可）')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('現在の管理設定を表示します。')
        ),

    // 5. ランキング（デバッグモード時のみ有効）
    new SlashCommandBuilder()
        .setName('ranking')
        .setDescription('配信者の同時接続数ランキングを今すぐ更新する（デバッグモード限定）'),

    // 6. タイムアウト一覧・延長
    new SlashCommandBuilder()
        .setName('timeoutlist')
        .setDescription('現在タイムアウト中のメンバーを一覧表示し、タイムアウトを延長できます。'),

    // 7. 危険権限保持者一覧
    new SlashCommandBuilder()
        .setName('permlist')
        .setDescription('危険な権限を持つロール・メンバーを一覧表示します。'),

].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('🧹 古いグローバルコマンドを掃除中...');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });

        console.log('🚀 最新のコマンドを登録中...');
        if (process.env.GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
                { body: commands }
            );
            console.log('✅ サーバー限定で登録完了');
        } else {
            await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
            console.log('✅ グローバルで登録完了');
        }
        console.log('💡 Discordを Ctrl+R で再起動して確認してください。');
    } catch (error) {
        console.error('❌ 登録中にエラーが発生しました:', error);
    }
})();