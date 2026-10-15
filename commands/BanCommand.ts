import {ChatInputCommandInteraction, Colors, PermissionFlagsBits, SlashCommandBuilder} from "discord.js";
import {logModAction, PointCommand} from "../PointManager.js";
import {createConfirmationEmbed, createErrorEmbed} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {recordModAction} from "../util/ModerationUtil.js";

export default {
	requiresUser: true,
	slashData: new SlashCommandBuilder().setName("ban").setDescription("Ban a member from the server")
		.addUserOption(option => option.setName("member").setDescription("The member to ban").setRequired(true))
		.addStringOption(option => option.setName("reason").setDescription("The reason for the ban"))
		.addIntegerOption(option => option.setName("delete_message_days").setDescription("Delete messages from the last N days (0-7)").setMinValue(0).setMaxValue(7))
		.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		if (!context.hasModAccess()) {
			await context.reply(createErrorEmbed(context.user, "❌ You don't have permission to ban members!"));
			return;
		}
		const user = interaction.options.getUser("member", true);
		const reason = interaction.options.getString("reason") || "No reason provided";
		const deleteDays = interaction.options.getInteger("delete_message_days") || 0;
		const member = await context.guild.members.fetch(user.id).catch(() => null);
		if (member && !member.bannable) {
			await context.reply(createErrorEmbed(context.user, "❌ I can't ban that member! They may have a higher role than me."));
			return;
		}
		await context.guild.bans.create(user.id, {reason, deleteMessageSeconds: deleteDays * 86400});
		recordModAction(context.guild.id, user.id, context.user.id, "ban", reason);
		logModAction(context, `Banned ${user} for: ${reason}`, Colors.Red);
		await context.reply(createConfirmationEmbed(context.user, `✅ Banned ${user} for: ${reason}`));
	}
} as PointCommand;
