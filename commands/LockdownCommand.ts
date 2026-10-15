import {ChannelType, ChatInputCommandInteraction, Colors, PermissionFlagsBits, SlashCommandBuilder, TextChannel} from "discord.js";
import {logModAction, PointCommand} from "../PointManager.js";
import {createConfirmationEmbed, createErrorEmbed} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";

export default {
	requiresUser: true,
	slashData: new SlashCommandBuilder().setName("lockdown").setDescription("Lock or unlock a channel")
		.addSubcommand(sub => sub.setName("lock").setDescription("Prevent @everyone from sending messages in a channel")
			.addChannelOption(option => option.setName("channel").setDescription("The channel to lock (defaults to current channel)").addChannelTypes(ChannelType.GuildText))
			.addStringOption(option => option.setName("reason").setDescription("The reason for the lockdown")))
		.addSubcommand(sub => sub.setName("unlock").setDescription("Restore @everyone's ability to send messages in a channel")
			.addChannelOption(option => option.setName("channel").setDescription("The channel to unlock (defaults to current channel)").addChannelTypes(ChannelType.GuildText)))
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		if (!context.hasModAccess()) {
			await context.reply(createErrorEmbed(context.user, "❌ You don't have permission to lock channels!"));
			return;
		}
		const sub = interaction.options.getSubcommand();
		const channel = (interaction.options.getChannel("channel") || context.channel) as TextChannel;
		if (!(channel instanceof TextChannel)) {
			await context.reply(createErrorEmbed(context.user, "❌ Lockdown can only be used on text channels!"));
			return;
		}
		if (sub === "lock") {
			const reason = interaction.options.getString("reason") || "No reason provided";
			await channel.permissionOverwrites.edit(context.guild.roles.everyone, {SendMessages: false}, {reason});
			logModAction(context, `Locked ${channel} - ${reason}`, Colors.Red);
			await context.reply(createConfirmationEmbed(context.user, `🔒 Locked ${channel}.`));
			return;
		}
		if (sub === "unlock") {
			await channel.permissionOverwrites.edit(context.guild.roles.everyone, {SendMessages: null});
			logModAction(context, `Unlocked ${channel}`, Colors.Green);
			await context.reply(createConfirmationEmbed(context.user, `🔓 Unlocked ${channel}.`));
		}
	}
} satisfies PointCommand;
