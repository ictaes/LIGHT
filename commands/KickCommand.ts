import {ChatInputCommandInteraction, Colors, PermissionFlagsBits, SlashCommandBuilder} from "discord.js";
import {logModAction, PointCommand} from "../PointManager.js";
import {createConfirmationEmbed, createErrorEmbed} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {recordModAction} from "../util/ModerationUtil.js";

export default {
	requiresUser: true,
	slashData: new SlashCommandBuilder().setName("kick").setDescription("Kick a member from the server")
		.addUserOption(option => option.setName("member").setDescription("The member to kick").setRequired(true))
		.addStringOption(option => option.setName("reason").setDescription("The reason for the kick"))
		.setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		if (!context.hasModAccess()) {
			await context.reply(createErrorEmbed(context.user, "❌ You don't have permission to kick members!"));
			return;
		}
		const user = interaction.options.getUser("member", true);
		const reason = interaction.options.getString("reason") || "No reason provided";
		const member = await context.guild.members.fetch(user.id).catch(() => null);
		if (!member) {
			await context.reply(createErrorEmbed(context.user, "❌ That member isn't in this server!"));
			return;
		}
		if (!member.kickable) {
			await context.reply(createErrorEmbed(context.user, "❌ I can't kick that member! They may have a higher role than me."));
			return;
		}
		await member.kick(reason);
		recordModAction(context.guild.id, member.id, context.user.id, "kick", reason);
		logModAction(context, `Kicked ${member} for: ${reason}`, Colors.Red);
		await context.reply(createConfirmationEmbed(context.user, `✅ Kicked ${member} for: ${reason}`));
	}
} as PointCommand;
