import {SlashCommandBuilder} from "discord.js";
import {PointCommand} from "../PointManager.js";
import {createConfirmationEmbed, createErrorEmbed, format, formatTime} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {claimWork, getCooldowns} from "../util/EconomyUtil.js";

const JOBS = [
	"delivered packages across town",
	"fixed a leaky server rack",
	"walked the neighbor's dog",
	"flipped burgers at the diner",
	"mowed a few lawns",
	"helped move furniture",
	"busked on the street corner",
	"washed cars at the lot"
];

export default {
	slashData: new SlashCommandBuilder().setName("work").setDescription("Work for some coins"),
	requiresUser: true,
	execute: async (context: BotUserContext) => {
		const settings = context.getSettings().economy;
		const amount = Math.floor(Math.random() * (settings.work_max - settings.work_min + 1)) + settings.work_min;
		const cooldownMs = settings.work_cooldown_hours * 3600000;
		if (claimWork(context.guild.id, context.id, amount, cooldownMs, settings.starting_balance)) {
			const job = JOBS[Math.floor(Math.random() * JOBS.length)];
			await context.reply(createConfirmationEmbed(context.user, `✅ You ${job} and earned ${format(amount)} 🪙!`));
			return;
		}
		const lastWork = getCooldowns(context.guild.id, context.id).last_work as number;
		const remaining = Math.ceil((lastWork + cooldownMs - Date.now()) / 1000);
		await context.reply(createErrorEmbed(context.user, `❌ You're still tired from your last job! Come back in ${formatTime(remaining)}.`));
	}
} as PointCommand;
