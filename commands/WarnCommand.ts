import {ChatInputCommandInteraction, Colors, PermissionFlagsBits, SlashCommandBuilder} from "discord.js";
import {logModAction, PointCommand} from "../PointManager.js";
import {createConfirmationEmbed, createErrorEmbed} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {addWarning, recordModAction} from "../util/ModerationUtil.js";

export default {
	requiresUser: true,
	slashData: new SlashCommandBuilder().setName("warn").setDescription("Warn a member")
		.addUserOption(option => option.setName("member").setDescription("The member to warn").setRequired(true))
		.addStringOption(option => option.setName("reason").setDescription("The reason for the warning").setRequired(true))
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		if (!context.hasModAccess()) {
			await context.reply(createErrorEmbed(context.user, "❌ You don't have permission to warn members!"));
			return;
		}
		const user = interaction.options.getUser("member", true);
		const reason = interaction.options.getString("reason", true);
		const total = addWarning(context.guild.id, user.id, context.user.id, reason);
		recordModAction(context.guild.id, user.id, context.user.id, "warn", reason);
		logModAction(context, `Warned ${user} for: ${reason} (now has ${total} warning${total === 1 ? "" : "s"})`, Colors.Yellow);
		await context.reply(createConfirmationEmbed(context.user, `⚠ Warned ${user} for: ${reason}\nThey now have **${total}** warning${total === 1 ? "" : "s"}.`));
	}
} as PointCommand;
