import {ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ChatInputCommandInteraction, Colors, GuildMember, MessageFlags, SlashCommandBuilder, Snowflake, TextChannel} from "discord.js";
import {GenericCommand} from "../PointManager.js";
import {BaseUserContext} from "../util/BaseUserContext.js";
import {createErrorEmbed, createConfirmationEmbed, createThemedEmbed} from "../util/EmbedUtil.js";
import {hasPermission} from "../util/PermissionUtil.js";
import {buildCustomId, ComponentInteraction, registerComponent} from "../util/ComponentRouter.js";
import {
	addChannel, countRecentPosters, getChannel, getHits, HONEYPOT_ACTIONS, HoneypotAction, listChannels,
	MAX_TIMEOUT_MS, removeChannel, setEnabled
} from "../util/security/HoneypotUtil.js";

//Configuring a honeypot is gated on manage_antinuke, which resolves only to real Discord Administrator and
//is deliberately excluded from the fake-permission grant list. Anything less would mean a role that can be
//handed out through the bot could point a honeypot at #general and ban the server.
const PERMISSION = "manage_antinuke";

/** Above this many distinct recent posters, adding a honeypot asks for confirmation first. */
const BUSY_CHANNEL_THRESHOLD = 3;

export default {
	requiresUser: false,
	slashData: new SlashCommandBuilder().setName("honeypot").setDescription("Bait channels that punish anyone who posts in them")
		.addSubcommand(sub => sub.setName("add").setDescription("Make a channel a honeypot")
			.addChannelOption(option => option.setName("channel").setDescription("The bait channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
			.addStringOption(option => option.setName("action").setDescription("What to do to anyone who posts there").setRequired(true)
				.addChoices(...HONEYPOT_ACTIONS.map(action => ({name: action, value: action}))))
			.addIntegerOption(option => option.setName("timeout_minutes").setDescription("Timeout length, if the action is timeout (default 60)").setMinValue(1).setMaxValue(40320))
			.addIntegerOption(option => option.setName("delete_hours").setDescription("Hours of the member's messages to delete on ban (default 1, max 168)").setMinValue(0).setMaxValue(168)))
		.addSubcommand(sub => sub.setName("remove").setDescription("Stop a channel being a honeypot")
			.addChannelOption(option => option.setName("channel").setDescription("The channel").setRequired(true)))
		.addSubcommand(sub => sub.setName("enable").setDescription("Re-arm a honeypot without losing its settings")
			.addChannelOption(option => option.setName("channel").setDescription("The channel").setRequired(true)))
		.addSubcommand(sub => sub.setName("disable").setDescription("Disarm a honeypot but keep its settings")
			.addChannelOption(option => option.setName("channel").setDescription("The channel").setRequired(true)))
		.addSubcommand(sub => sub.setName("list").setDescription("List this server's honeypot channels"))
		.addSubcommand(sub => sub.setName("history").setDescription("Show recent honeypot triggers")),
	execute: async (context: BaseUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		if (!context.member) return;
		if (!hasPermission(context.member, PERMISSION)) {
			await context.reply(createErrorEmbed(context.user, "❌ You need to be an administrator to configure honeypots."));
			return;
		}

		switch (interaction.options.getSubcommand()) {
			case "add": return await handleAdd(context, interaction);
			case "remove": return await handleRemove(context, interaction);
			case "enable": return await handleToggle(context, interaction, true);
			case "disable": return await handleToggle(context, interaction, false);
			case "list": return await handleList(context);
			case "history": return await handleHistory(context);
		}
	}
} satisfies GenericCommand;

function describe(action: HoneypotAction, timeoutMs: number | null, deleteSeconds: number): string {
	if (action === "timeout") return `timeout for ${Math.round((timeoutMs ?? 0) / 60000)} minute(s)`;
	if (action === "ban") return `ban, deleting ${Math.round(deleteSeconds / 3600)} hour(s) of their messages`;
	return "kick";
}

async function handleAdd(context: BaseUserContext, interaction: ChatInputCommandInteraction) {
	const channel = interaction.options.getChannel("channel", true);
	const action = interaction.options.getString("action", true) as HoneypotAction;
	const timeoutMs = Math.min((interaction.options.getInteger("timeout_minutes") ?? 60) * 60_000, MAX_TIMEOUT_MS);
	const deleteSeconds = (interaction.options.getInteger("delete_hours") ?? 1) * 3600;

	const resolved = context.guild.channels.cache.get(channel.id);
	if (!(resolved instanceof TextChannel)) {
		await context.reply(createErrorEmbed(context.user, "❌ That channel could not be resolved as a text channel."));
		return;
	}

	//The check that matters. A honeypot pointed at a channel people actually use is not a misconfiguration
	//that produces an error message - it is one that bans everyone who talks there, one at a time.
	const posters = await countRecentPosters(resolved);
	if (posters > BUSY_CHANNEL_THRESHOLD) {
		await context.reply({
			embeds: [
				createThemedEmbed(context.user, "⚠ That channel looks like it is in use")
					.setDescription(`**${posters}** different people have posted in ${resolved} recently.\n\nIf you make it a honeypot, every one of them will be **${describe(action, timeoutMs, deleteSeconds)}** the next time they post.\n\nAre you sure?`)
					.setColor(Colors.Yellow).toJSON()
			],
			components: [
				new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder().setStyle(ButtonStyle.Danger).setLabel("Add it anyway")
						.setCustomId(buildCustomId("honeypot", "confirm", resolved.id, action, timeoutMs, deleteSeconds)),
					new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel("Cancel")
						.setCustomId(buildCustomId("honeypot", "cancel"))
				)
			]
		});
		return;
	}

	addChannel(context.guild.id, resolved.id, action, timeoutMs, deleteSeconds, context.id);
	await context.reply(createConfirmationEmbed(context.user, `🍯 ${resolved} is now a honeypot. Anyone who posts there will be **${describe(action, timeoutMs, deleteSeconds)}**.\n\nModerators, the server owner and bots are exempt.`));
}

async function handleRemove(context: BaseUserContext, interaction: ChatInputCommandInteraction) {
	const channel = interaction.options.getChannel("channel", true);
	if (!removeChannel(context.guild.id, channel.id)) {
		await context.reply(createErrorEmbed(context.user, "⚠ That channel is not a honeypot."));
		return;
	}
	await context.reply(createConfirmationEmbed(context.user, `<#${channel.id}> is no longer a honeypot.`));
}

async function handleToggle(context: BaseUserContext, interaction: ChatInputCommandInteraction, enabled: boolean) {
	const channel = interaction.options.getChannel("channel", true);
	if (!setEnabled(context.guild.id, channel.id, enabled)) {
		await context.reply(createErrorEmbed(context.user, "⚠ That channel is not a honeypot."));
		return;
	}
	await context.reply(createConfirmationEmbed(context.user, `Honeypot in <#${channel.id}> is now **${enabled ? "armed" : "disarmed"}**.`));
}

async function handleList(context: BaseUserContext) {
	const rows = listChannels(context.guild.id);
	if (rows.length === 0) {
		await context.reply(createConfirmationEmbed(context.user, "No honeypot channels are configured."));
		return;
	}
	await context.reply({
		embeds: [
			createThemedEmbed(context.user, "🍯 Honeypot channels").setDescription(
				rows.map(row => `<#${row.channel}> — **${describe(row.action as HoneypotAction, row.timeout_duration, row.delete_message_seconds)}** ${row.enabled ? "✅ armed" : "⛔ disarmed"}`).join("\n")
			).toJSON()
		]
	});
}

async function handleHistory(context: BaseUserContext) {
	const hits = getHits(context.guild.id, 10);
	if (hits.length === 0) {
		await context.reply(createConfirmationEmbed(context.user, "No honeypot triggers recorded yet."));
		return;
	}
	await context.reply({
		embeds: [
			createThemedEmbed(context.user, "🍯 Recent honeypot triggers").setDescription(
				hits.map(hit => `${hit.succeeded ? "✅" : "❌"} <@${hit.member}> in <#${hit.channel}> — **${hit.action}** <t:${Math.floor(hit.created_at / 1000)}:R>${hit.succeeded ? "" : `\n└ failed: ${hit.error}`}`).join("\n")
			).toJSON()
		]
	});
}

//Registered at module load, which happens during the command directory scan - before the gateway can
//deliver an interaction, so there is no window where the button exists but its handler does not.
registerComponent("honeypot", "confirm", async (interaction: ComponentInteraction, args: string[]) => {
	if (!interaction.isButton()) return;
	//Re-checked on the press, not just when the button was drawn. The message is visible to everyone in the
	//channel, so without this anyone could click a confirmation an admin left on screen.
	if (!(interaction.member instanceof GuildMember) || !hasPermission(interaction.member, PERMISSION)) {
		await interaction.reply({content: "❌ You need to be an administrator to do that.", flags: MessageFlags.Ephemeral});
		return;
	}
	const [channel, action, timeoutMs, deleteSeconds] = args;
	addChannel(interaction.guildId as Snowflake, channel, action as HoneypotAction, parseInt(timeoutMs), parseInt(deleteSeconds), interaction.user.id);
	await interaction.update({
		embeds: [
			createThemedEmbed(interaction.user, "🍯 Honeypot added")
				.setDescription(`<#${channel}> is now a honeypot. Anyone who posts there will be **${describe(action as HoneypotAction, parseInt(timeoutMs), parseInt(deleteSeconds))}**.`)
				.setColor(Colors.Orange).toJSON()
		],
		components: []
	});
});

registerComponent("honeypot", "cancel", async (interaction: ComponentInteraction) => {
	if (!interaction.isButton()) return;
	if (!(interaction.member instanceof GuildMember) || !hasPermission(interaction.member, PERMISSION)) {
		await interaction.reply({content: "❌ You need to be an administrator to do that.", flags: MessageFlags.Ephemeral});
		return;
	}
	await interaction.update({
		embeds: [createThemedEmbed(interaction.user, "Cancelled").setDescription("No honeypot was added.").toJSON()],
		components: []
	});
});
