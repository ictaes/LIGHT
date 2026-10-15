import {SlashCommandBuilder} from "discord.js";
import {PointCommand} from "../PointManager.js";
import {createConfirmationEmbed, createErrorEmbed, format, formatTime} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {claimDaily, getCooldowns} from "../util/EconomyUtil.js";

export default {
	slashData: new SlashCommandBuilder().setName("daily").setDescription("Claim your daily coins"),
	requiresUser: true,
	execute: async (context: BotUserContext) => {
		const settings = context.getSettings().economy;
		const cooldownMs = settings.daily_cooldown_hours * 3600000;
		if (claimDaily(context.guild.id, context.id, settings.daily_amount, cooldownMs, settings.starting_balance)) {
			await context.reply(createConfirmationEmbed(context.user, `✅ You claimed your daily ${format(settings.daily_amount)} 🪙!`));
			return;
		}
		const lastDaily = getCooldowns(context.guild.id, context.id).last_daily as number;
		const remaining = Math.ceil((lastDaily + cooldownMs - Date.now()) / 1000);
		await context.reply(createErrorEmbed(context.user, `❌ You already claimed your daily coins! Come back in ${formatTime(remaining)}.`));
	}
} satisfies PointCommand;
