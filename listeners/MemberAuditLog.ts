import {Colors, EmbedBuilder, GuildMember, PartialGuildMember} from "discord.js";
import {getModLogChannelForGuild} from "../util/ModerationUtil.js";

export async function handleMemberAdd(member: GuildMember) {
	const channel = getModLogChannelForGuild(member.guild);
	if (!channel) return;
	await channel.send({
		embeds: [
			new EmbedBuilder().setAuthor({name: member.user.tag, iconURL: member.user.displayAvatarURL()})
				.setTitle("Member joined")
				.setDescription(`${member} (${member.user.tag})\n**Account created:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`)
				.setColor(Colors.Green).setTimestamp().toJSON()
		]
	}).catch(console.error);
}

export async function handleMemberRemove(member: GuildMember | PartialGuildMember) {
	const channel = getModLogChannelForGuild(member.guild);
	if (!channel) return;
	await channel.send({
		embeds: [
			new EmbedBuilder().setAuthor({name: member.user.tag, iconURL: member.user.displayAvatarURL()})
				.setTitle("Member left")
				.setDescription(`${member} (${member.user.tag})\n**Joined:** ${member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "Unknown"}`)
				.setColor(Colors.Orange).setTimestamp().toJSON()
		]
	}).catch(console.error);
}
