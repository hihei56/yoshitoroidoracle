// intro_template.js — 自己紹介テンプレートのEmbed
const { EmbedBuilder } = require('discord.js');

function buildIntroTemplateEmbed() {
    return new EmbedBuilder()
        .setTitle('自己紹介テンプレート')
        .setDescription(
            '【名前】\n' +
            '【性別】\n' +
            '【年齢】\n' +
            '【趣味】\n' +
            '【自分を弱者男性だと思う理由】'
        )
        .setColor(0x57F287)
        .setFooter({ text: 'テンプレートは守らなくてもいいよ。' });
}

module.exports = { buildIntroTemplateEmbed };
