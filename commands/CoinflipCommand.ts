import {ChatInputCommandInteraction, Colors, EmbedBuilder, SlashCommandBuilder} from "discord.js";
import {PointCommand} from "../PointManager.js";
import {createErrorEmbed, format} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {addBalance, getBalance} from "../util/EconomyUtil.js";

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
		const balance = getBalance(context.guild.id, context.id, settings.starting_balance);
		if (amount > balance) {
			await context.reply(createErrorEmbed(context.user, "❌ You don't have enough coins for that bet!"));
			return;
		}

		const result = Math.random() < 0.5 ? "heads" : "tails";
		const won = result === choice;
		const newBalance = addBalance(context.guild.id, context.id, won ? amount : -amount, settings.starting_balance);

		await context.reply({
			embeds: [
				new EmbedBuilder().setAuthor(context.asAuthor())
					.setDescription(`The coin landed on **${result}**! You ${won ? "won" : "lost"} ${format(amount)} 🪙.\nNew balance: ${format(newBalance)} 🪙`)
					.setColor(won ? Colors.Green : Colors.Red).setTimestamp().toJSON()
			]
		});
	}
} satisfies PointCommand;
