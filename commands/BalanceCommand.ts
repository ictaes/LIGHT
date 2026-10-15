import {ChatInputCommandInteraction, SlashCommandBuilder, User} from "discord.js";
import {PointCommand} from "../PointManager.js";
import {createThemedEmbed, format} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {getBalance} from "../util/EconomyUtil.js";

export default {
	slashData: new SlashCommandBuilder().setName("balance").setDescription("Check your or another member's balance")
		.addUserOption(option => option.setName("member").setDescription("The member to check")),
	requiresUser: true,
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		const user: User = interaction.options.getUser("member") || context.user;
		const balance = getBalance(context.guild.id, user.id, context.getSettings().economy.starting_balance);
		await context.reply({
			embeds: [
				createThemedEmbed(user, "Balance").setDescription(`${format(balance)} 🪙`).toJSON()
			]
		});
	}
} satisfies PointCommand;
