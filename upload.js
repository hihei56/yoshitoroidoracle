// upload.js
const { MessageFlags } = require('discord.js');

async function handleUpload(interaction) {
    const file = interaction.options.getAttachment('file');
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }); // 修正ポイント！
    
    try {
        await interaction.channel.send({ files: [file.url] });
        await interaction.editReply('アップロード');
    } catch (e) { 
        await interaction.editReply('アップロード失敗'); 
    }
}
module.exports = { handleUpload };