import {SlashCommandBuilder} from "discord.js";
import {GenericCommand, getCommandId} from "../PointManager.js";
import {createThemedEmbed} from "../util/EmbedUtil.js";
import {BaseUserContext} from "../util/BaseUserContext.js";

export default {
	requiresUser: false,
	slashData: new SlashCommandBuilder().setName("help").setDescription("See a command list"),
	execute: async (context: BaseUserContext) => {
		await context.reply({
			embeds: [
				createThemedEmbed(context.user)
					.setFields(
						{
							name: "General", value: `
</addwin:${getCommandId("addwin")}> - Register a win for yourself
</removewin:${getCommandId("removewin")}> - Remove a win (if misadded)
</profile:${getCommandId("profile")}> - See your or someone else's profile
</leaderboard:${getCommandId("leaderboard")}> - See the leaderboard
</roles:${getCommandId("roles")}> - See all role rewards
</help:${getCommandId("help")}> - See this list
</shortcommands:${getCommandId("shortcommands")}> - See a list of legacy-style commands (shorter and faster to type)
</about:${getCommandId("about")}> - See infos about the bot`
						},
						{
							name: "Orders & Clashes", value: `
</order create:${getCommandId("order")}> - Create a new order (mod only)
</order join:${getCommandId("order")}> - Join an order
</order leave:${getCommandId("order")}> - Leave your order
</order info:${getCommandId("order")}> - View an order's info
</order list:${getCommandId("order")}> - List all orders
</order leaderboard:${getCommandId("order")}> - View an order's leaderboard
</order promote:${getCommandId("order")}> - Promote/demote an officer
</order edit:${getCommandId("order")}> - Edit your order (leader only)
</order disband:${getCommandId("order")}> - Disband your order
</clash declare:${getCommandId("clash")}> - Declare a clash with another order
</clash end:${getCommandId("clash")}> - End your order's active clash early
</clash info:${getCommandId("clash")}> - View a clash's status`
						},
						{
							name: "Moderation", value: `
</addwin:${getCommandId("addwin")}> - Register a win for someone else
</removewin:${getCommandId("removewin")}> - Remove a win from someone else
</modifypoints:${getCommandId("modifypoints")}> - Modify a user's points or wins
</rolerefresh:${getCommandId("rolerefresh")}> - Recalculate a user's roles
</kick:${getCommandId("kick")}> - Kick a member
</ban:${getCommandId("ban")}> - Ban a member
</timeout:${getCommandId("timeout")}> - Time out a member
</warn:${getCommandId("warn")}> - Warn a member
</warnings list:${getCommandId("warnings")}> - View a member's warnings
</warnings clear:${getCommandId("warnings")}> - Clear a member's warnings
</slowmode:${getCommandId("slowmode")}> - Set channel slowmode
</lockdown lock:${getCommandId("lockdown")}> - Lock a channel
</lockdown unlock:${getCommandId("lockdown")}> - Unlock a channel
</reactionrole add:${getCommandId("reactionrole")}> - Add a reaction role
</reactionrole remove:${getCommandId("reactionrole")}> - Remove a reaction role`
						},
						{
							name: "Admin", value: `
</multiplier set:${getCommandId("multiplier")}> - Set the current multiplier
</multiplier clear:${getCommandId("multiplier")}> - Remove the current multiplier
</multiplier setend:${getCommandId("multiplier")}> - Set the end date of the current multiplier
</settings show:${getCommandId("settings")}> - Change server settings
</automod show:${getCommandId("automod")}> - View auto-moderation config
</automod enable:${getCommandId("automod")}> - Enable auto-moderation`
						}
					).toJSON()
			]
		});
	},
} as GenericCommand;