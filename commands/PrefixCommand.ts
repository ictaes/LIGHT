import {ChatInputCommandInteraction, Colors, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder} from "discord.js";
import {PointCommand} from "../PointManager.js";
import {createConfirmationEmbed, createErrorEmbed} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {disablePrefix, getPrefixConfig, setPrefix} from "../util/PrefixConfigUtil.js";

const MAX_PREFIX_LENGTH = 5;

export default {
	requiresUser: true,
	slashData: new SlashCommandBuilder().setName("prefix").setDescription("Configure the text-command prefix")
		.addSubcommand(sub => sub.setName("set").setDescription("Set and enable the text-command prefix")
			.addStringOption(option => option.setName("prefix").setDescription("The prefix to use (1-5 characters, no spaces)").setRequired(true)))
		.addSubcommand(sub => sub.setName("disable").setDescription("Disable the text-command prefix (mentioning the bot still works)"))
		.addSubcommand(sub => sub.setName("status").setDescription("Show the current prefix configuration"))
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
	execute: async (context: BotUserContext) => {
		if (!context.hasModAccess()) {
			await context.reply(createErrorEmbed(context.user, "❌ You don't have permission to configure the prefix!"));
			return;
		}
		const interaction = context.base as ChatInputCommandInteraction;
		const sub = interaction.options.getSubcommand();

		if (sub === "set") {
			const prefix = interaction.options.getString("prefix", true);
			if (prefix.length > MAX_PREFIX_LENGTH || /\s/.test(prefix)) {
				await context.reply(createErrorEmbed(context.user, `❌ The prefix must be 1-${MAX_PREFIX_LENGTH} characters with no spaces.`));
				return;
			}
			setPrefix(context.guild.id, prefix);
			await context.reply(createConfirmationEmbed(context.user, `✅ Text commands can now be used with \`${prefix}\` (e.g. \`${prefix}balance\`). Mentioning the bot also always works.`));
		} else if (sub === "disable") {
			const disabled = disablePrefix(context.guild.id);
			await context.reply(disabled
				? createConfirmationEmbed(context.user, "✅ The custom prefix is disabled. Mentioning the bot still works for text commands.")
				: createErrorEmbed(context.user, "❌ No custom prefix was configured."));
		} else if (sub === "status") {
			const config = getPrefixConfig(context.guild.id);
			await context.reply({
				embeds: [
					new EmbedBuilder().setAuthor(context.asAuthor()).setTitle("Prefix configuration")
						.setDescription(config && config.enabled
							? `**Prefix:** \`${config.prefix}\`\nMentioning the bot also always works.`
							: "No custom prefix configured. Mentioning the bot still works for text commands.")
						.setColor(Colors.Blurple).setTimestamp().toJSON()
				]
			});
		}
	}
} satisfies PointCommand;
