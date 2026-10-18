import {ChatInputCommandInteraction, Colors, EmbedBuilder, SlashCommandBuilder} from "discord.js";
import {PointCommand, rewards} from "../PointManager.js";
import {BotUserContext} from "../util/BotUserContext.js";

export default {
	requiresUser: true,
	slashData: new SlashCommandBuilder().setName("points").setDescription("Points-related commands")
		.addSubcommand(sub => sub.setName("rewardroles").setDescription("See the point milestone reward roles")),
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		const sub = interaction.options.getSubcommand();
		if (sub === "rewardroles") {
			const roles = rewards.getRewardList(context).filter(role => role.type === "points");
			await context.reply({
				embeds: [
					new EmbedBuilder().setAuthor({name: "Point reward roles", iconURL: context.guild.iconURL() || undefined})
						.setDescription(roles.length === 0 ? "None" : roles.map(role => `<@&${role.role_id}> • Reach ${role.count} points`).join("\n"))
						.setColor(Colors.Blurple).setTimestamp().toJSON()
				]
			});
		}
	}
} satisfies PointCommand;
