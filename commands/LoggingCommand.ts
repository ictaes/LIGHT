import {ChannelType, ChatInputCommandInteraction, SlashCommandBuilder, TextChannel} from "discord.js";
import {GenericCommand} from "../PointManager.js";
import {BaseUserContext} from "../util/BaseUserContext.js";
import {createConfirmationEmbed, createErrorEmbed, createThemedEmbed} from "../util/EmbedUtil.js";
import {hasPermission} from "../util/PermissionUtil.js";
import {
	CATEGORY_DESCRIPTIONS, clearLogChannel, getLogConfig, LOG_CATEGORIES, LogCategory, resolveLogChannel,
	setLogChannel, setLogEnabled
} from "../util/LogUtil.js";

const PERMISSION = "manage_logging";

//Discord allows at most 25 choices per option, and there are 11 categories - but assert it rather than
//assume, because the list is meant to grow.
const categoryChoices = LOG_CATEGORIES.slice(0, 25).map(category => ({name: `${category} — ${CATEGORY_DESCRIPTIONS[category]}`.slice(0, 100), value: category}));

export default {
	requiresUser: false,
	slashData: new SlashCommandBuilder().setName("logging").setDescription("Route each kind of log to its own channel")
		.addSubcommand(sub => sub.setName("set").setDescription("Send a log category to a channel")
			.addStringOption(option => option.setName("category").setDescription("What to log").setRequired(true).addChoices(...categoryChoices))
			.addChannelOption(option => option.setName("channel").setDescription("Where to send it").addChannelTypes(ChannelType.GuildText).setRequired(true)))
		.addSubcommand(sub => sub.setName("clear").setDescription("Stop routing a category, falling back to the legacy log channel")
			.addStringOption(option => option.setName("category").setDescription("The category").setRequired(true).addChoices(...categoryChoices)))
		.addSubcommand(sub => sub.setName("enable").setDescription("Turn a category back on")
			.addStringOption(option => option.setName("category").setDescription("The category").setRequired(true).addChoices(...categoryChoices)))
		.addSubcommand(sub => sub.setName("disable").setDescription("Silence a category without losing its channel")
			.addStringOption(option => option.setName("category").setDescription("The category").setRequired(true).addChoices(...categoryChoices)))
		.addSubcommand(sub => sub.setName("status").setDescription("Show where every log category currently goes")),
	execute: async (context: BaseUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		if (!context.member) return;
		if (!hasPermission(context.member, PERMISSION)) {
			await context.reply(createErrorEmbed(context.user, "❌ You need the Manage Server permission to configure logging."));
			return;
		}

		const subcommand = interaction.options.getSubcommand();
		if (subcommand === "status") return await handleStatus(context);

		const category = interaction.options.getString("category", true) as LogCategory;
		switch (subcommand) {
			case "set": {
				const channel = interaction.options.getChannel("channel", true);
				if (!(context.guild.channels.cache.get(channel.id) instanceof TextChannel)) {
					await context.reply(createErrorEmbed(context.user, "❌ That channel could not be resolved as a text channel."));
					return;
				}
				setLogChannel(context.guild.id, category, channel.id, context.id);
				await context.reply(createConfirmationEmbed(context.user, `**${category}** logs now go to <#${channel.id}>.`));
				return;
			}
			case "clear": {
				if (!clearLogChannel(context.guild.id, category)) {
					await context.reply(createErrorEmbed(context.user, `⚠ **${category}** was not routed anywhere.`));
					return;
				}
				await context.reply(createConfirmationEmbed(context.user, `**${category}** is no longer routed and will fall back to the legacy log channel.`));
				return;
			}
			case "enable":
			case "disable": {
				const enabled = subcommand === "enable";
				if (!setLogEnabled(context.guild.id, category, enabled)) {
					await context.reply(createErrorEmbed(context.user, `⚠ **${category}** has no channel set — use \`/logging set\` first.`));
					return;
				}
				await context.reply(createConfirmationEmbed(context.user, `**${category}** logging is now **${enabled ? "on" : "off"}**.`));
				return;
			}
		}
	}
} satisfies GenericCommand;

async function handleStatus(context: BaseUserContext) {
	//Shows the *resolved* destination, not just the configured one. A server can have no per-category
	//routing at all and still be logging fine through the legacy channel - or, far more commonly, have
	//neither, in which case every log it produces is being silently discarded and nothing says so.
	const lines = LOG_CATEGORIES.map(category => {
		const row = getLogConfig(context.guild.id, category);
		if (row && !row.enabled) return `⛔ **${category}** — disabled`;
		const resolved = resolveLogChannel(context.guild, category);
		if (!resolved) return `⚠ **${category}** — nowhere, these logs are discarded`;
		return `${row ? "📍" : "↩"} **${category}** — <#${resolved.id}>${row ? "" : " (legacy fallback)"}`;
	});

	const discarded = lines.filter(line => line.startsWith("⚠")).length;
	await context.reply({
		embeds: [
			createThemedEmbed(context.user, "Log routing")
				.setDescription(lines.join("\n"))
				.setFooter({text: discarded > 0 ? `${discarded} categor${discarded === 1 ? "y is" : "ies are"} being discarded — use /logging set` : "📍 routed · ↩ legacy fallback"})
				.toJSON()
		]
	});
}
