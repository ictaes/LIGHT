import {ChatInputCommandInteraction, Colors, EmbedBuilder, SlashCommandBuilder} from "discord.js";
import {PointCommand, rewards} from "../PointManager.js";
import {BotUserContext} from "../util/BotUserContext.js";

export default {
	requiresUser: true,
	slashData: new SlashCommandBuilder().setName("wins").setDescription("Win-related commands")
		.addSubcommand(sub => sub.setName("rewardroles").setDescription("See the win milestone reward roles")),
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		const sub = interaction.options.getSubcommand();
		if (sub === "rewardroles") {
			const roles = rewards.getRewardList(context).filter(role => role.type === "wins");
			await context.reply({
				embeds: [
					new EmbedBuilder().setAuthor({name: "Win reward roles", iconURL: context.guild.iconURL() || undefined})
						.setDescription(roles.length === 0 ? "None" : roles.map(role => `<@&${role.role_id}> • Reach ${role.count} wins`).join("\n"))
						.setColor(Colors.Blurple).setTimestamp().toJSON()
				]
			});
		}
	}
} satisfies PointCommand;
