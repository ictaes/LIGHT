import {SlashCommandBuilder} from "discord.js";
import {client, GenericCommand} from "../PointManager.js";
import {createThemedEmbed} from "../util/EmbedUtil.js";
import {BaseUserContext} from "../util/BaseUserContext.js";

//Kept in sync by hand with the parsers in util/EntryMessageHandler.ts and the tryXEntryMessage functions in
//AddWinCommand, RemoveWinCommand, LeaderboardCommand, ProfileCommand and MultiplierCommand. If you add a
//form there, add it here - several of the forms below went undocumented for a long time.
export default {
	requiresUser: false,
	slashData: new SlashCommandBuilder().setName("shortcommands").setDescription("See the short message-based command forms"),
	execute: async (context: BaseUserContext) => {
		//A real mention rather than literal "@LIGHT" text, matching what this command has always shown.
		const ping = `<@${client.user?.id}> `;
		await context.reply({
			embeds: [
				createThemedEmbed(context.user, "Short commands")
					.setDescription(`Some commands have shorter message forms that are faster to type than a slash command.\n\nAll of them work either by mentioning me **or by replying to one of my messages**, in which case you can leave the mention out.`)
					.setFields(
						{
							name: "Registering wins",
							value: [
								`**${ping}500** — register a win of 500 points`,
								`**${ping}500x2** — multiply before registering (\`*\` and \`×\` also work)`,
								`**${ping}-500** — remove a win of 500 points`,
								`**${ping}500 @user1 @user2** — bulk add to up to 20 members (mod only)`,
								`An optional verb is allowed and ignored, so **${ping}add 500**, **${ping}a 500** and **${ping}win 500** all work.`
							].join("\n")
						},
						{
							name: "Profiles & leaderboard",
							value: [
								`**${ping}p** — your profile`,
								`**${ping}@user** — someone else's profile`,
								`**${ping}<user id>** — a profile by raw user ID`,
								`**${ping}bob** — a profile by partial name, matching nickname or username`,
								`**${ping}lb** — the leaderboard`,
								`**${ping}7d** — the leaderboard for the last 7 days (any number from 1 to 30)`
							].join("\n")
						},
						{
							name: "Multiplier",
							value: `**${ping}mult** — see the current multiplier, if any\nAlso accepts \`multi\`, \`multiplier\`, \`boost\`, \`double\` and \`x2\`.`
						}
					).toJSON()
			]
		});
	},
} satisfies GenericCommand;
