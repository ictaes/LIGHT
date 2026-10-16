import {SlashCommandBuilder} from "discord.js";
import {GenericCommand, getCommandId} from "../PointManager.js";
import {createThemedEmbed} from "../util/EmbedUtil.js";
import {BaseUserContext} from "../util/BaseUserContext.js";

/**
 * Renders a clickable slash-command mention. `command` defaults to the first word, which is the top-level
 * command name for every subcommand here.
 */
function cmd(path: string, command: string = path.split(" ")[0]): string {
	return `</${path}:${getCommandId(command)}>`;
}

interface HelpSection {
	name: string;
	entries: string[];
}

function sections(): HelpSection[] {
	return [
		{
			name: "General",
			entries: [
				`${cmd("addwin")} - Register a win for yourself`,
				`${cmd("removewin")} - Remove a win (if misadded)`,
				`${cmd("profile")} - See your or someone else's profile`,
				`${cmd("leaderboard")} - See the leaderboard`,
				`${cmd("graph alltime")} - Graph points over all time`,
				`${cmd("graph month")} / ${cmd("graph week")} - Graph a recent period`,
				`${cmd("graph custom")} - Graph a custom timeframe`,
				`${cmd("roles")} - See all role rewards`,
				`${cmd("shortcommands")} - Shorter, faster-to-type forms of these`,
				`${cmd("about")} - See infos about the bot`,
				`${cmd("ping")} - Check that the bot is responding`,
				`${cmd("help")} - See this list`
			]
		},
		{
			name: "Economy",
			entries: [
				`${cmd("balance")} - Check your or someone's balance`,
				`${cmd("pay")} - Send coins to another member`,
				`${cmd("daily")} - Claim your daily coins`,
				`${cmd("work")} - Work for coins`,
				`${cmd("shop list")} - See what is for sale`,
				`${cmd("shop buy")} - Buy an item`,
				`${cmd("shop inventory")} - See the items you own`,
				`${cmd("coinflip")} - Bet coins on a coin flip`,
				`${cmd("slots")} - Bet coins on the slot machine`
			]
		},
		{
			name: "Orders & Clashes",
			entries: [
				`${cmd("order create")} - Create a new order (mod only)`,
				`${cmd("order join")} - Join an order`,
				`${cmd("order leave")} - Leave your order`,
				`${cmd("order info")} - View an order's info`,
				`${cmd("order list")} - List all orders`,
				`${cmd("order leaderboard")} - View an order's leaderboard`,
				`${cmd("order promote")} - Promote/demote an officer`,
				`${cmd("order edit")} - Edit your order (leader only)`,
				`${cmd("order disband")} - Disband your order`,
				`${cmd("clash declare")} - Declare a clash with another order`,
				`${cmd("clash end")} - End your order's active clash early`,
				`${cmd("clash info")} - View a clash's status`
			]
		},
		{
			name: "Moderation",
			entries: [
				`${cmd("addwin")} - Register a win for someone else`,
				`${cmd("removewin")} - Remove a win from someone else`,
				`${cmd("modifypoints")} - Modify a user's points or wins`,
				`${cmd("rolerefresh")} - Recalculate a user's roles`,
				`${cmd("kick")} - Kick a member`,
				`${cmd("ban")} - Ban a member`,
				`${cmd("timeout")} - Time out a member`,
				`${cmd("warn")} - Warn a member`,
				`${cmd("warnings list")} - View a member's warnings`,
				`${cmd("warnings clear")} - Clear a member's warnings`,
				`${cmd("slowmode")} - Set channel slowmode`,
				`${cmd("lockdown lock")} - Lock a channel`,
				`${cmd("lockdown unlock")} - Unlock a channel`,
				`${cmd("reactionrole add")} - Add a reaction role`,
				`${cmd("reactionrole remove")} - Remove a reaction role`
			]
		},
		{
			name: "Security",
			entries: [
				`${cmd("honeypot add")} - Make a channel a honeypot (bans anyone who posts)`,
				`${cmd("honeypot remove")} - Stop a channel being a honeypot`,
				`${cmd("honeypot enable")} / ${cmd("honeypot disable")} - Arm or disarm one`,
				`${cmd("honeypot list")} - List honeypot channels`,
				`${cmd("honeypot history")} - See recent honeypot triggers`,
				`${cmd("logging status")} - See where every log category goes`,
				`${cmd("logging set")} - Send a log category to a channel`,
				`${cmd("logging clear")} - Stop routing a category`,
				`${cmd("logging enable")} / ${cmd("logging disable")} - Toggle a category`
			]
		},
		{
			name: "Admin",
			entries: [
				`${cmd("settings show")} - Change server settings`,
				`${cmd("setup")} - Run first-time setup`,
				`${cmd("multiplier set")} - Set the current multiplier`,
				`${cmd("multiplier clear")} - Remove the current multiplier`,
				`${cmd("multiplier setend")} - Set the multiplier's end date`,
				`${cmd("automod show")} - View auto-moderation config`,
				`${cmd("automod enable")} / ${cmd("automod disable")} - Toggle auto-moderation`,
				`${cmd("economy show")} - View the economy configuration`,
				`${cmd("economy config")} - Set amounts, cooldowns and bet limits`,
				`${cmd("economy additem")} / ${cmd("economy edititem")} / ${cmd("economy removeitem")} - Manage shop items`,
				`${cmd("economy setbalance")} - Set a member's balance`,
				`${cmd("subscribefeed")} - Send game results to a webhook`,
				`${cmd("unsubscribefeed")} - Stop sending game results`,
				`${cmd("import")} - Import data from another bot`,
				`${cmd("removedata")} - Delete your data`
			]
		}
	];
}

/** Discord's per-field cap. Exceeding it rejects the *whole* embed, so /help would break outright. */
const MAX_FIELD_LENGTH = 1024;

/**
 * Flattens the sections into embed fields, splitting any that would overflow.
 *
 * Without this, adding one command too many to a section silently breaks the entire help embed rather than
 * truncating it - which is a worse version of the problem this list already had, where whole features were
 * shipped and never listed here at all.
 */
function toFields(): { name: string, value: string }[] {
	const fields: { name: string, value: string }[] = [];
	for (const section of sections()) {
		let value = "";
		let part = 0;
		const push = () => fields.push({name: part++ === 0 ? section.name : `${section.name} (cont.)`, value});
		for (const entry of section.entries) {
			//`value &&` matters: a single entry longer than the cap would otherwise push an empty field
			//value, which Discord rejects just as hard as an over-long one.
			if (value && value.length + entry.length + 1 > MAX_FIELD_LENGTH) {
				push();
				value = "";
			}
			value += (value ? "\n" : "") + entry;
		}
		if (value) push();
	}
	return fields;
}

export default {
	requiresUser: false,
	slashData: new SlashCommandBuilder().setName("help").setDescription("See a command list"),
	execute: async (context: BaseUserContext) => {
		await context.reply({
			embeds: [
				//The note goes in the description, not the footer: createThemedEmbed already puts the LIGHT
				//branding there, and overwriting it would quietly undo the branding pass.
				createThemedEmbed(context.user)
					.setDescription("-# Not every command is available to everyone — some need moderator or admin permissions.")
					.setFields(toFields())
					.toJSON()
			]
		});
	},
} satisfies GenericCommand;
