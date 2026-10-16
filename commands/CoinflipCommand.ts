import {ChatInputCommandInteraction, Colors, EmbedBuilder, SlashCommandBuilder} from "discord.js";
import {PointCommand} from "../PointManager.js";
import {createErrorEmbed, format} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {addBalance, placeBet} from "../util/EconomyUtil.js";

export default {
	slashData: new SlashCommandBuilder().setName("coinflip").setDescription("Bet coins on a coin flip")
		.addIntegerOption(option => option.setName("amount").setDescription("The amount to bet").setRequired(true).setMinValue(1))
		.addStringOption(option => option.setName("choice").setDescription("Heads or tails").setRequired(true).addChoices({name: "Heads", value: "heads"}, {name: "Tails", value: "tails"})),
	requiresUser: true,
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		const amount = interaction.options.getInteger("amount", true);
		const choice = interaction.options.getString("choice", true);
		const settings = context.getSettings().economy;

		if (settings.max_bet !== null && amount > settings.max_bet) {
			await context.reply(createErrorEmbed(context.user, `❌ The max bet is ${format(settings.max_bet)} 🪙!`));
			return;
		}
		if (!placeBet(context.guild.id, context.id, amount, settings.starting_balance)) {
			await context.reply(createErrorEmbed(context.user, "❌ You don't have enough coins for that bet!"));
			return;
		}

		const result = Math.random() < 0.5 ? "heads" : "tails";
		const won = result === choice;
		// The bet was already deducted atomically above. On a win, credit back the bet plus the
		// winnings (2x the bet) so the net change matches the original +amount; on a loss, nothing
		// further is credited so the net change matches the original -amount.
		const newBalance = addBalance(context.guild.id, context.id, won ? amount * 2 : 0, settings.starting_balance);

		await context.reply({
			embeds: [
				new EmbedBuilder().setAuthor(context.asAuthor())
					.setDescription(`The coin landed on **${result}**! You ${won ? "won" : "lost"} ${format(amount)} 🪙.\nNew balance: ${format(newBalance)} 🪙`)
					.setColor(won ? Colors.Green : Colors.Red).setTimestamp().toJSON()
			]
		});
	}
} satisfies PointCommand;
