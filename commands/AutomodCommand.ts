import {ChatInputCommandInteraction, Colors, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder} from "discord.js";
import {PointCommand} from "../PointManager.js";
import {updateSettings} from "../BotSettingProvider.js";
import {createConfirmationEmbed, createErrorEmbed} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";

export default {
	requiresUser: true,
	slashData: new SlashCommandBuilder().setName("automod").setDescription("Configure auto-moderation")
		.addSubcommand(sub => sub.setName("enable").setDescription("Enable auto-moderation"))
		.addSubcommand(sub => sub.setName("disable").setDescription("Disable auto-moderation"))
		.addSubcommand(sub => sub.setName("spam").setDescription("Configure spam filtering")
			.addBooleanOption(option => option.setName("enabled").setDescription("Enable or disable this filter").setRequired(true))
			.addIntegerOption(option => option.setName("max_messages").setDescription("Max messages allowed in the interval").setMinValue(2).setMaxValue(50))
			.addIntegerOption(option => option.setName("interval_seconds").setDescription("Interval length in seconds").setMinValue(1).setMaxValue(60)))
		.addSubcommand(sub => sub.setName("links").setDescription("Configure link/invite filtering")
			.addBooleanOption(option => option.setName("enabled").setDescription("Enable or disable this filter").setRequired(true))
			.addBooleanOption(option => option.setName("allow_invites").setDescription("Allow Discord invite links"))
			.addStringOption(option => option.setName("whitelist_domain").setDescription("A domain to allow (e.g. youtube.com) - run multiple times to add more")))
		.addSubcommand(sub => sub.setName("caps").setDescription("Configure caps filtering")
			.addBooleanOption(option => option.setName("enabled").setDescription("Enable or disable this filter").setRequired(true))
			.addIntegerOption(option => option.setName("max_percent").setDescription("Max percent of letters that can be uppercase").setMinValue(10).setMaxValue(100))
			.addIntegerOption(option => option.setName("min_length").setDescription("Minimum message length before this filter applies").setMinValue(1).setMaxValue(100)))
		.addSubcommand(sub => sub.setName("mentions").setDescription("Configure mention spam filtering")
			.addBooleanOption(option => option.setName("enabled").setDescription("Enable or disable this filter").setRequired(true))
			.addIntegerOption(option => option.setName("max_mentions").setDescription("Max number of mentions allowed per message").setMinValue(1).setMaxValue(50)))
		.addSubcommand(sub => sub.setName("punishment").setDescription("Set what happens when a filter is triggered")
			.addStringOption(option => option.setName("action").setDescription("The punishment to apply").setRequired(true).addChoices({name: "Delete only", value: "delete"}, {name: "Delete + warn", value: "warn"}, {name: "Delete + timeout", value: "timeout"}))
			.addIntegerOption(option => option.setName("timeout_seconds").setDescription("Timeout duration in seconds (only used if action is timeout)").setMinValue(1)))
		.addSubcommand(sub => sub.setName("show").setDescription("Show the current auto-moderation configuration"))
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		if (!context.hasModAccess()) {
			await context.reply(createErrorEmbed(context.user, "❌ You don't have permission to configure auto-moderation!"));
			return;
		}
		const sub = interaction.options.getSubcommand();
		const automod = context.getSettings().automod;

		if (sub === "enable") {
			automod.enabled = true;
		} else if (sub === "disable") {
			automod.enabled = false;
		} else if (sub === "spam") {
			automod.spam = {
				enabled: interaction.options.getBoolean("enabled", true),
				max_messages: interaction.options.getInteger("max_messages") ?? automod.spam?.max_messages ?? 5,
				interval_seconds: interaction.options.getInteger("interval_seconds") ?? automod.spam?.interval_seconds ?? 5
			};
		} else if (sub === "links") {
			const whitelistDomain = interaction.options.getString("whitelist_domain");
			const whitelist = automod.links?.whitelist || [];
			if (whitelistDomain && !whitelist.includes(whitelistDomain)) whitelist.push(whitelistDomain);
			automod.links = {
				enabled: interaction.options.getBoolean("enabled", true),
				allow_invites: interaction.options.getBoolean("allow_invites") ?? automod.links?.allow_invites ?? false,
				whitelist
			};
		} else if (sub === "caps") {
			automod.caps = {
				enabled: interaction.options.getBoolean("enabled", true),
				max_percent: interaction.options.getInteger("max_percent") ?? automod.caps?.max_percent ?? 70,
				min_length: interaction.options.getInteger("min_length") ?? automod.caps?.min_length ?? 10
			};
		} else if (sub === "mentions") {
			automod.mention_spam = {
				enabled: interaction.options.getBoolean("enabled", true),
				max_mentions: interaction.options.getInteger("max_mentions") ?? automod.mention_spam?.max_mentions ?? 5
			};
		} else if (sub === "punishment") {
			automod.punishment = interaction.options.getString("action", true) as "delete" | "warn" | "timeout";
			const timeoutSeconds = interaction.options.getInteger("timeout_seconds");
			if (timeoutSeconds) automod.timeout_seconds = timeoutSeconds;
		} else if (sub === "show") {
			await context.reply({
				embeds: [
					new EmbedBuilder().setAuthor(context.asAuthor()).setTitle("Auto-moderation configuration")
						.setDescription([
							`**Enabled:** ${automod.enabled}`,
							`**Spam:** ${automod.spam ? `${automod.spam.enabled} (max ${automod.spam.max_messages} msgs / ${automod.spam.interval_seconds}s)` : "not configured"}`,
							`**Links:** ${automod.links ? `${automod.links.enabled} (invites allowed: ${automod.links.allow_invites}, whitelist: ${automod.links.whitelist.join(", ") || "none"})` : "not configured"}`,
							`**Caps:** ${automod.caps ? `${automod.caps.enabled} (max ${automod.caps.max_percent}%, min length ${automod.caps.min_length})` : "not configured"}`,
							`**Mentions:** ${automod.mention_spam ? `${automod.mention_spam.enabled} (max ${automod.mention_spam.max_mentions})` : "not configured"}`,
							`**Punishment:** ${automod.punishment}${automod.punishment === "timeout" ? ` (${automod.timeout_seconds}s)` : ""}`
						].join("\n")).setColor(Colors.Blurple).setTimestamp().toJSON()
				]
			});
			return;
		}
		updateSettings();
		await context.reply(createConfirmationEmbed(context.user, "✅ Auto-moderation settings updated."));
	}
} satisfies PointCommand;
