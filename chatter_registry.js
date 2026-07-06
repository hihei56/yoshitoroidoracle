// chatter_registry.js — chatterが投稿した各メッセージが、実際は誰(lurker)のなりすましかを記録
// moderator.jsとchatter.js間の循環requireを避けるため、単独の小さなモジュールに切り出す
const MAX_ENTRIES = 200;
const messageLurkers = new Map(); // messageId -> lurkerId

function registerChatterMessage(messageId, lurkerId) {
    messageLurkers.set(messageId, lurkerId);
    if (messageLurkers.size > MAX_ENTRIES) {
        messageLurkers.delete(messageLurkers.keys().next().value);
    }
}

function getChatterLurkerId(messageId) {
    return messageLurkers.get(messageId) ?? null;
}

module.exports = { registerChatterMessage, getChatterLurkerId };
