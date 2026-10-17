import {ChatInputCommandInteraction, Colors, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder} from "discord.js";
import {isRegisteredCommandName, PointCommand} from "../PointManager.js";
import {createConfirmationEmbed, createErrorEmbed} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {addAlias, getAllAliases, removeAlias} from "../util/PrefixConfigUtil.js";

export default {
	requiresUser: true,
	slashData: new SlashCommandBuilder().setName("alias").setDescription("Configure text-command aliases")
		.addSubcommand(sub => sub.setName("add").setDescription("Add or update an alias for a command")
			.addStringOption(option => option.setName("alias").setDescription("The shortcut to type (e.g. b)").setRequired(true))
			.addStringOption(option => option.setName("command").setDescription("The real command name it should run (e.g. balance)").setRequired(true)))
		.addSubcommand(sub => sub.setName("remove").setDescription("Remove an alias")
			.addStringOption(option => option.setName("alias").setDescription("The alias to remove").setRequired(true)))
		.addSubcommand(sub => sub.setName("list").setDescription("List configured aliases"))
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
	execute: async (context: BotUserContext) => {
		if (!context.hasModAccess()) {
			await context.reply(createErrorEmbed(context.user, "❌ You don't have permission to configure aliases!"));
			return;
		}
		const interaction = context.base as ChatInputCommandInteraction;
		const sub = interaction.options.getSubcommand();

		if (sub === "add") {
			const alias = interaction.options.getString("alias", true).toLowerCase();
			const command = interaction.options.getString("command", true).toLowerCase();
			if (isRegisteredCommandName(alias)) {
				await context.reply(createErrorEmbed(context.user, `❌ \`${alias}\` is already a real command name and can't be used as an alias.`));
				return;
			}
			if (!isRegisteredCommandName(command)) {
				await context.reply(createErrorEmbed(context.user, `❌ \`${command}\` is not a registered command.`));
				return;
			}
			addAlias(context.guild.id, alias, command);
			await context.reply(createConfirmationEmbed(context.user, `✅ \`${alias}\` now runs \`${command}\` as a text command.`));
		} else if (sub === "remove") {
			const alias = interaction.options.getString("alias", true).toLowerCase();
			const removed = removeAlias(context.guild.id, alias);
			await context.reply(removed
				? createConfirmationEmbed(context.user, `✅ Removed the alias \`${alias}\`.`)
				: createErrorEmbed(context.user, `❌ No alias named \`${alias}\` exists.`));
		} else if (sub === "list") {
			const aliases = getAllAliases(context.guild.id);
			await context.reply({
				embeds: [
					new EmbedBuilder().setAuthor(context.asAuthor()).setTitle("Command aliases")
						.setDescription(aliases.length === 0 ? "No aliases configured." : aliases.map(a => `\`${a.alias}\` → \`${a.command}\``).join("\n"))
						.setColor(Colors.Blurple).setTimestamp().toJSON()
				]
			});
		}
	}
} satisfies PointCommand;
