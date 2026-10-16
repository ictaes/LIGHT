import {ChatInputCommandInteraction, Colors, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder} from "discord.js";
import {PointCommand} from "../PointManager.js";
import {createConfirmationEmbed, createErrorEmbed} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {clearAllWarnings, clearWarning, getWarnings} from "../util/ModerationUtil.js";

export default {
	requiresUser: true,
	slashData: new SlashCommandBuilder().setName("warnings").setDescription("View or manage a member's warning history")
		.addSubcommand(sub => sub.setName("list").setDescription("List a member's warnings")
			.addUserOption(option => option.setName("member").setDescription("The member to check").setRequired(true)))
		.addSubcommand(sub => sub.setName("clear").setDescription("Clear a member's warnings")
			.addUserOption(option => option.setName("member").setDescription("The member to clear warnings for").setRequired(true))
			.addIntegerOption(option => option.setName("id").setDescription("Specific warning id to clear (omit to clear all)")))
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		if (!context.hasModAccess()) {
			await context.reply(createErrorEmbed(context.user, "❌ You don't have permission to view warnings!"));
			return;
		}
		const sub = interaction.options.getSubcommand();
		const user = interaction.options.getUser("member", true);
		if (sub === "list") {
			const warnings = getWarnings(context.guild.id, user.id);
			if (warnings.length === 0) {
				await context.reply(createConfirmationEmbed(context.user, `${user} has no warnings.`));
				return;
			}
			const description = warnings.slice(0, 15).map(w => `**#${w.id}** <t:${Math.floor(w.created_at / 1000)}:R> by <@${w.moderator}>\n${w.reason}`).join("\n\n");
			await context.reply({
				embeds: [
					new EmbedBuilder().setAuthor(context.asAuthor())
						.setTitle(`Warnings for ${user.tag} (${warnings.length} total)`)
						.setDescription(description).setColor(Colors.Yellow).setTimestamp().toJSON()
				]
			});
			return;
		}
		if (sub === "clear") {
			const id = interaction.options.getInteger("id");
			if (id !== null) {
				const cleared = clearWarning(id, context.guild.id, user.id);
				if (cleared) {
					await context.reply(createConfirmationEmbed(context.user, `✅ Cleared warning #${id} for ${user}.`));
				} else {
					await context.reply(createErrorEmbed(context.user, `❌ No warning #${id} found for ${user}.`));
				}
			} else {
				const count = clearAllWarnings(context.guild.id, user.id);
				await context.reply(createConfirmationEmbed(context.user, `✅ Cleared ${count} warning${count === 1 ? "" : "s"} for ${user}.`));
			}
		}
	}
} satisfies PointCommand;
