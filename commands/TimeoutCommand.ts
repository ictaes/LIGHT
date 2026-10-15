import {ChatInputCommandInteraction, Colors, PermissionFlagsBits, SlashCommandBuilder} from "discord.js";
import {logModAction, PointCommand} from "../PointManager.js";
import {createConfirmationEmbed, createErrorEmbed, formatTime} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {recordModAction} from "../util/ModerationUtil.js";

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

export function parseDuration(input: string): number | null {
	const match = input.trim().match(/^(\d+)\s*([smhd])$/i);
	if (!match) return null;
	const amount = parseInt(match[1]);
	const multiplier = ({s: 1000, m: 60000, h: 3600000, d: 86400000} as { [key: string]: number })[match[2].toLowerCase()];
	return amount * multiplier;
}

export default {
	requiresUser: true,
	slashData: new SlashCommandBuilder().setName("timeout").setDescription("Time out a member, or clear their timeout")
		.addUserOption(option => option.setName("member").setDescription("The member to time out").setRequired(true))
		.addStringOption(option => option.setName("duration").setDescription("Duration (e.g. 10m, 1h, 1d) or \"clear\" to remove timeout").setRequired(true))
		.addStringOption(option => option.setName("reason").setDescription("The reason for the timeout"))
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		if (!context.hasModAccess()) {
			await context.reply(createErrorEmbed(context.user, "❌ You don't have permission to time out members!"));
			return;
		}
		const user = interaction.options.getUser("member", true);
		const reason = interaction.options.getString("reason") || "No reason provided";
		const durationInput = interaction.options.getString("duration", true);
		const member = await context.guild.members.fetch(user.id).catch(() => null);
		if (!member) {
			await context.reply(createErrorEmbed(context.user, "❌ That member isn't in this server!"));
			return;
		}
		if (!member.moderatable) {
			await context.reply(createErrorEmbed(context.user, "❌ I can't time out that member! They may have a higher role than me."));
			return;
		}
		if (durationInput.toLowerCase() === "clear") {
			await member.timeout(null, reason);
			logModAction(context, `Cleared timeout for ${member} - ${reason}`, Colors.Yellow);
			await context.reply(createConfirmationEmbed(context.user, `✅ Cleared timeout for ${member}`));
			return;
		}
		const ms = parseDuration(durationInput);
		if (!ms || ms <= 0) {
			await context.reply(createErrorEmbed(context.user, "❌ Invalid duration! Use a format like `10m`, `1h`, or `1d`, or `clear` to remove a timeout."));
			return;
		}
		const clamped = Math.min(ms, MAX_TIMEOUT_MS);
		await member.timeout(clamped, reason);
		recordModAction(context.guild.id, member.id, context.user.id, "timeout", reason, Math.floor(clamped / 1000));
		logModAction(context, `Timed out ${member} for ${formatTime(clamped / 1000)} - ${reason}`, Colors.Yellow);
		await context.reply(createConfirmationEmbed(context.user, `✅ Timed out ${member} for ${formatTime(clamped / 1000)}`));
	}
} satisfies PointCommand;
