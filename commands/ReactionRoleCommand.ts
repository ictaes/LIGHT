import {ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder, TextChannel} from "discord.js";
import {PointCommand} from "../PointManager.js";
import {createConfirmationEmbed, createErrorEmbed} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import * as db from "../db/DataBaseManager.js";

const database = db.getProvider();

export default {
	requiresUser: true,
	slashData: new SlashCommandBuilder().setName("reactionrole").setDescription("Manage reaction roles")
		.addSubcommand(sub => sub.setName("add").setDescription("Add a reaction role to a message")
			.addStringOption(option => option.setName("message_id").setDescription("The ID of the message to react to").setRequired(true))
			.addStringOption(option => option.setName("emoji").setDescription("The emoji to react with").setRequired(true))
			.addRoleOption(option => option.setName("role").setDescription("The role to grant").setRequired(true)))
		.addSubcommand(sub => sub.setName("remove").setDescription("Remove a reaction role from a message")
			.addStringOption(option => option.setName("message_id").setDescription("The ID of the message").setRequired(true))
			.addStringOption(option => option.setName("emoji").setDescription("The emoji to remove").setRequired(true)))
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		if (!context.hasModAccess()) {
			await context.reply(createErrorEmbed(context.user, "❌ You don't have permission to manage reaction roles!"));
			return;
		}
		const sub = interaction.options.getSubcommand();
		const messageId = interaction.options.getString("message_id", true);
		const emoji = interaction.options.getString("emoji", true);

		let message = null;
		if (context.channel instanceof TextChannel) {
			message = await context.channel.messages.fetch(messageId).catch(() => null);
		}
		if (!message) {
			await context.reply(createErrorEmbed(context.user, "❌ Couldn't find that message in this channel! Run this command in the same channel as the message."));
			return;
		}

		if (sub === "add") {
			const role = interaction.options.getRole("role", true);
			const reacted = await message.react(emoji).catch(() => null);
			if (!reacted) {
				await context.reply(createErrorEmbed(context.user, "❌ Invalid emoji!"));
				return;
			}
			// Normalize to how MessageReactionAdd/Remove events will identify this emoji: id for custom emojis, the unicode character for standard ones.
			const key = reacted.emoji.id || reacted.emoji.name || emoji;
			database.prepare("INSERT OR REPLACE INTO reaction_roles (guild, message, emoji, role) VALUES (?, ?, ?, ?)").run(context.guild.id, messageId, key, role.id);
			await context.reply(createConfirmationEmbed(context.user, `✅ Reacting with ${emoji} on that message now grants <@&${role.id}>.`));
			return;
		}
		if (sub === "remove") {
			const reaction = message.reactions.cache.find(r => r.emoji.name === emoji || r.emoji.toString() === emoji || r.emoji.id === emoji);
			const key = reaction ? (reaction.emoji.id || reaction.emoji.name || emoji) : emoji;
			database.prepare("DELETE FROM reaction_roles WHERE message = ? AND emoji = ?").run(messageId, key);
			if (reaction) await reaction.remove().catch(() => {
			});
			await context.reply(createConfirmationEmbed(context.user, `✅ Removed the reaction role for ${emoji} on that message.`));
		}
	}
} as PointCommand;
