import {ChatInputCommandInteraction, Colors, EmbedBuilder, SlashCommandBuilder} from "discord.js";
import {PointCommand} from "../PointManager.js";
import {createErrorEmbed, format} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {addBalance, placeBet} from "../util/EconomyUtil.js";

// Uniform 1/5 odds per symbol per reel. Expected value is deliberately < 1x bet (~-14%) so
// repeated play doesn't become a reliable way to print coins - see plan notes on house edge.
const SYMBOLS = [
	{emoji: "🍒", multiplier: 3},
	{emoji: "🍋", multiplier: 4},
	{emoji: "🔔", multiplier: 6},
	{emoji: "💎", multiplier: 10},
	{emoji: "7️⃣", multiplier: 25}
];

function spin() {
	return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
}

export default {
	slashData: new SlashCommandBuilder().setName("slots").setDescription("Bet coins on the slot machine")
		.addIntegerOption(option => option.setName("amount").setDescription("The amount to bet").setRequired(true).setMinValue(1)),
	requiresUser: true,
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		const amount = interaction.options.getInteger("amount", true);
		const settings = context.getSettings().economy;

		if (settings.max_bet !== null && amount > settings.max_bet) {
			await context.reply(createErrorEmbed(context.user, `❌ The max bet is ${format(settings.max_bet)} 🪙!`));
			return;
		}
		if (!placeBet(context.guild.id, context.id, amount, settings.starting_balance)) {
			await context.reply(createErrorEmbed(context.user, "❌ You don't have enough coins for that bet!"));
			return;
		}

		const reels = [spin(), spin(), spin()];
		const allMatch = reels[0].emoji === reels[1].emoji && reels[1].emoji === reels[2].emoji;
		const anyPair = reels[0].emoji === reels[1].emoji || reels[1].emoji === reels[2].emoji || reels[0].emoji === reels[2].emoji;

		// The bet was already deducted atomically above. `credit` is the amount to add back on top
		// of that deduction so the net change matches the original (pre-fix) delta math exactly:
		// jackpot net should be amount * (multiplier - 1), so credit amount * multiplier; a push
		// should return the bet (net 0), so credit amount; a loss keeps the deduction (net -amount),
		// so credit 0.
		let credit: number;
		let delta: number;
		let outcome: string;
		if (allMatch) {
			credit = amount * reels[0].multiplier;
			delta = amount * (reels[0].multiplier - 1);
			outcome = `Jackpot! You won ${format(delta)} 🪙.`;
		} else if (anyPair) {
			credit = amount;
			delta = 0;
			outcome = "So close! Your bet was returned.";
		} else {
			credit = 0;
			delta = -amount;
			outcome = `You lost ${format(amount)} 🪙.`;
		}
		const newBalance = addBalance(context.guild.id, context.id, credit, settings.starting_balance);

		await context.reply({
			embeds: [
				new EmbedBuilder().setAuthor(context.asAuthor())
					.setDescription(`[ ${reels.map(r => r.emoji).join(" | ")} ]\n${outcome}\nNew balance: ${format(newBalance)} 🪙`)
					.setColor(delta > 0 ? Colors.Green : (delta < 0 ? Colors.Red : Colors.Blurple)).setTimestamp().toJSON()
			]
		});
	}
} satisfies PointCommand;
