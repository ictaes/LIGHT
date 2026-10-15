import {ChatInputCommandInteraction, SlashCommandBuilder} from "discord.js";
import {PointCommand} from "../PointManager.js";
import {createConfirmationEmbed, createErrorEmbed, format} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {transfer} from "../util/EconomyUtil.js";

export default {
	slashData: new SlashCommandBuilder().setName("pay").setDescription("Send coins to another member")
		.addUserOption(option => option.setName("member").setDescription("The member to pay").setRequired(true))
		.addIntegerOption(option => option.setName("amount").setDescription("The amount to send").setRequired(true).setMinValue(1)),
	requiresUser: true,
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		const user = interaction.options.getUser("member", true);
		const amount = interaction.options.getInteger("amount", true);
		if (user.id === context.id) {
			await context.reply(createErrorEmbed(context.user, "❌ You can't pay yourself!"));
			return;
		}
		const startingBalance = context.getSettings().economy.starting_balance;
		if (!transfer(context.guild.id, context.id, user.id, amount, startingBalance)) {
			await context.reply(createErrorEmbed(context.user, "❌ You don't have enough coins for that!"));
			return;
		}
		await context.reply(createConfirmationEmbed(context.user, `✅ Sent ${format(amount)} 🪙 to ${user}.`));
	}
} as PointCommand;
