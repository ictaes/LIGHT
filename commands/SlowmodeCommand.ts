import {ChannelType, ChatInputCommandInteraction, Colors, PermissionFlagsBits, SlashCommandBuilder, TextChannel} from "discord.js";
import {logModAction, PointCommand} from "../PointManager.js";
import {createConfirmationEmbed, createErrorEmbed} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";

export default {
	requiresUser: true,
	slashData: new SlashCommandBuilder().setName("slowmode").setDescription("Set slowmode for a channel")
		.addIntegerOption(option => option.setName("seconds").setDescription("Slowmode duration in seconds (0 to disable)").setRequired(true).setMinValue(0).setMaxValue(21600))
		.addChannelOption(option => option.setName("channel").setDescription("The channel to apply slowmode to (defaults to current channel)").addChannelTypes(ChannelType.GuildText))
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		if (!context.hasModAccess()) {
			await context.reply(createErrorEmbed(context.user, "❌ You don't have permission to set slowmode!"));
			return;
		}
		const seconds = interaction.options.getInteger("seconds", true);
		const channel = (interaction.options.getChannel("channel") || context.channel) as TextChannel;
		if (!(channel instanceof TextChannel)) {
			await context.reply(createErrorEmbed(context.user, "❌ Slowmode can only be set on text channels!"));
			return;
		}
		await channel.setRateLimitPerUser(seconds);
		logModAction(context, `Set slowmode to ${seconds}s in ${channel}`, Colors.Yellow);
		await context.reply(createConfirmationEmbed(context.user, seconds === 0 ? `✅ Disabled slowmode in ${channel}.` : `✅ Set slowmode to ${seconds}s in ${channel}.`));
	}
} satisfies PointCommand;
