import {Colors, EmbedBuilder, Message, PartialMessage} from "discord.js";
import {emitLog} from "../util/LogUtil.js";

export async function handleMessageDelete(message: Message | PartialMessage) {
	if (!message.guild) return;
	if (message.author && message.author.bot) return;
	const content = message.partial ? "*Content unavailable (message was not cached)*" : (message.content || "*No text content*");
	const embed = new EmbedBuilder()
		.setAuthor(message.author ? {name: message.author.tag, iconURL: message.author.displayAvatarURL()} : {name: "Unknown user"})
		.setTitle("Message deleted")
		.setDescription(`**Channel:** <#${message.channelId}>\n**Content:**\n${content}`)
		.setColor(Colors.Red).setTimestamp();
	emitLog(message.guild, "message", embed, message.channelId);
}

export async function handleMessageUpdate(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) {
	if (!newMessage.guild) return;
	if (newMessage.author && newMessage.author.bot) return;
	if (oldMessage.partial) return; // can't reliably diff, and avoids logging embed-load-only updates
	if (oldMessage.content === newMessage.content) return;
	const newContent = newMessage.partial ? "*Content unavailable*" : (newMessage.content || "*No text content*");
	const embed = new EmbedBuilder()
		.setAuthor(newMessage.author ? {name: newMessage.author.tag, iconURL: newMessage.author.displayAvatarURL()} : {name: "Unknown user"})
		.setTitle("Message edited")
		.setDescription(`**Channel:** <#${newMessage.channelId}>\n**Before:**\n${oldMessage.content || "*No text content*"}\n**After:**\n${newContent}`)
		.setColor(Colors.Yellow).setTimestamp();
	if (newMessage.url) embed.setURL(newMessage.url);
	emitLog(newMessage.guild, "message", embed, newMessage.channelId);
}
