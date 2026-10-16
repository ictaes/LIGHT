import {ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, Colors, EmbedBuilder, GuildMember, Message, MessageFlags, NewsChannel, Snowflake, TextChannel} from "discord.js";
import {client} from "../PointManager.js";
import {getGuildsForClan, getServerContext} from "../BotSettingProvider.js";
//LimitedServerSettings, not ServerSetting: it is what BotUserContext.getSettings() returns, and the full
//ServerSetting is assignable to it. Typing the helpers this way means neither call site needs a cast.
import {BotUserContext, getUser, LimitedServerSettings} from "./BotUserContext.js";
import {format, toRewardString} from "./EmbedUtil.js";
import {ClanGame} from "./ClanGame.js";
import {buildCustomId, registerComponent} from "./ComponentRouter.js";

const NAMESPACE = "winfeed";
/** Index used for the plain 1x button, which is not one of the configured factor buttons. */
const BASE_FACTOR = "base";
const EXPIRY_MS = 300000;

interface ClaimRecord {
	/** The multiplier of the button that was pressed. Shown in the Claimed by list. */
	factor: number;
	/** Points actually credited, multiplier included. Stored rather than recomputed - see handleUnclaim. */
	awarded: number;
	/** Button label at the time of the claim, so the list reads the same even if settings change. */
	label: string;
}

interface FeedEntry {
	msg: Message;
	guild: Snowflake;
	/** Base points for the game, before any button factor or server multiplier. */
	points: number;
	game: ClanGame;
	timestamp: number;
	claimed: { [key: Snowflake]: ClaimRecord };
}

let messageCache: { [key: Snowflake]: FeedEntry } = {};

function factorButtons(settings: LimitedServerSettings): { id: string, label: string, factor: number }[] {
	return settings.factor_buttons.map((button, index) => ({
		id: String(index),
		label: button.name,
		factor: button.factor
	}));
}

function resolveButton(settings: LimitedServerSettings, id: string): { label: string, factor: number } | null {
	if (id === BASE_FACTOR) return {label: "Claim", factor: 1};
	const button = settings.factor_buttons[parseInt(id)];
	return button ? {label: button.name, factor: button.factor} : null;
}

function buildEmbed(entry: FeedEntry): EmbedBuilder {
	const game = entry.game;
	const embed = new EmbedBuilder()
		.setTitle(`🏆 ${game.clan} Victory`)
		.setColor(Colors.Green)
		.setTimestamp(entry.timestamp)
		.addFields(
			{
				name: "Map",
				value: `${game.map}\n${format(entry.points)} points${game.contest ? " *(contest ×2)*" : ""}`,
				inline: true
			},
			{
				//Named "Clan points" rather than "Clan ranking": the game feed carries this clan's score and
				//gain but not its position or its neighbours, and inventing either would be worse than
				//omitting them. Add the surrounding ranks here once a source for them exists.
				name: "Clan points",
				value: `**${game.clan}** — ${game.currClanPoints.toFixed(5)}\n+${game.gainPoints.toFixed(5)}`,
				inline: true
			}
		);

	const claimers = Object.entries(entry.claimed);
	if (claimers.length > 0) {
		embed.addFields({
			name: "Claimed by",
			value: claimers.map(([user, record]) => `<@${user}> \`${record.label} ${record.factor}×\``).join("\n").slice(0, 1024),
			inline: false
		});
	}
	return embed;
}

function buildComponents(settings: LimitedServerSettings): ActionRowBuilder<ButtonBuilder>[] {
	const buttons = [
		new ButtonBuilder().setCustomId(buildCustomId(NAMESPACE, "claim", BASE_FACTOR)).setLabel("Claim (1×)").setStyle(ButtonStyle.Secondary),
		//A factor above 1 is a bonus and below 1 is a reduction, so the colour carries that rather than
		//being decorative.
		...factorButtons(settings).map(button =>
			new ButtonBuilder().setCustomId(buildCustomId(NAMESPACE, "claim", button.id))
				.setLabel(`${button.label} (${button.factor}×)`)
				.setStyle(button.factor >= 1 ? ButtonStyle.Success : ButtonStyle.Danger))
	];

	//Discord allows five buttons per row. Unclaim goes on its own row so it cannot be mis-clicked while
	//reaching for the last factor button.
	const rows: ActionRowBuilder<ButtonBuilder>[] = [];
	for (let i = 0; i < buttons.length; i += 5) {
		rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
	}
	rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(buildCustomId(NAMESPACE, "unclaim")).setLabel("Unclaim").setEmoji("🔁").setStyle(ButtonStyle.Danger)
	));
	return rows;
}

export async function sendToFeed(clan: string, message: string, points: number, gameDetails: ClanGame) {
	for (const guild of getGuildsForClan(clan)) {
		const g = client.guilds.cache.get(guild);
		if (!g) continue;
		const settings = getServerContext(guild);
		if (!settings) continue;
		if (!settings.win_feed) continue;
		const channel = g.channels.cache.get(settings.win_feed);
		if (!channel || !(channel instanceof TextChannel || channel instanceof NewsChannel)) continue;

		const entry: FeedEntry = {msg: null as unknown as Message, guild, points, game: gameDetails, timestamp: Date.now(), claimed: {}};
		const msg = await channel.send({
			embeds: [buildEmbed(entry).toJSON()],
			components: buildComponents(settings)
		}).catch(() => {});
		if (!msg) continue;
		entry.msg = msg;
		messageCache[msg.id] = entry;
	}
}

function refreshMessage(entry: FeedEntry) {
	const settings = getServerContext(entry.guild);
	if (!settings) return;
	entry.msg.edit({
		embeds: [buildEmbed(entry).toJSON()],
		components: buildComponents(settings)
	}).catch(() => {});
}

//Takes a ButtonInteraction rather than the wider ComponentInteraction because getUser only accepts the
//interaction types BaseUserContext knows how to read a user out of. Both callers narrow first.
function resolve(interaction: ButtonInteraction): { entry: FeedEntry, context: BotUserContext } | null {
	if (!(interaction.member instanceof GuildMember)) return null;
	const entry = messageCache[interaction.message?.id ?? ""];
	if (!entry) return null;
	if (entry.timestamp + EXPIRY_MS < Date.now()) return null;
	const context = getUser(interaction.member, interaction);
	if (!(context instanceof BotUserContext)) return null;
	return {entry, context};
}

registerComponent(NAMESPACE, "claim", async (interaction, args) => {
	if (!interaction.isButton()) return;
	const resolved = resolve(interaction);
	if (!resolved) return;
	const {entry, context} = resolved;

	const button = resolveButton(context.getSettings(), args[0]);
	if (!button) return;

	const existing = entry.claimed[interaction.user.id];
	if (existing && existing.factor === button.factor) {
		await interaction.reply({
			embeds: [new EmbedBuilder().setAuthor(context.asAuthor()).setDescription("You have already claimed this win!").setColor(Colors.Red).setTimestamp().toJSON()],
			flags: MessageFlags.Ephemeral
		}).catch(() => {});
		return;
	}

	//Switching factor: take back exactly what was credited before, not a fresh calculation. The server
	//multiplier can change between the two presses, and recomputing would remove a different number of
	//points than were added.
	if (existing) await context.removeWin(existing.awarded);

	const multiplier = context.getActiveMultiplier();
	const shown = Math.ceil(entry.points * button.factor);
	const awarded = Math.ceil(shown * (multiplier ? multiplier.amount : 1));

	const response = await context.registerWin(awarded);
	entry.claimed[interaction.user.id] = {factor: button.factor, awarded, label: button.label};
	refreshMessage(entry);

	await interaction.reply({
		embeds: [
			new EmbedBuilder().setAuthor(context.asAuthor())
				.setDescription(`${existing ? "Updated your claim to" : "Registered win of"} ${format(shown)} ${multiplier ? `\`x ${multiplier.amount} (multiplier)\` ` : ``}points` + toRewardString(response, true, false))
				.setTimestamp().setColor(Colors.Green).toJSON()
		],
		flags: MessageFlags.Ephemeral
	}).catch(() => {});
});

registerComponent(NAMESPACE, "unclaim", async interaction => {
	if (!interaction.isButton()) return;
	const resolved = resolve(interaction);
	if (!resolved) return;
	const {entry, context} = resolved;

	const existing = entry.claimed[interaction.user.id];
	if (!existing) {
		await interaction.reply({
			embeds: [new EmbedBuilder().setAuthor(context.asAuthor()).setDescription("You have not claimed this win.").setColor(Colors.Red).setTimestamp().toJSON()],
			flags: MessageFlags.Ephemeral
		}).catch(() => {});
		return;
	}

	//Deducts the stored amount rather than recomputing, so an unclaim always undoes exactly what the claim
	//did even if the multiplier has since changed or expired.
	const response = await context.removeWin(existing.awarded);
	delete entry.claimed[interaction.user.id];
	refreshMessage(entry);

	await interaction.reply({
		embeds: [
			new EmbedBuilder().setAuthor(context.asAuthor())
				.setDescription(`Removed your claim of ${format(existing.awarded)} points` + toRewardString(response, false, false))
				.setTimestamp().setColor(Colors.Red).toJSON()
		],
		flags: MessageFlags.Ephemeral
	}).catch(() => {});
});

function refresh() {
	for (const id of Object.keys(messageCache)) {
		const entry = messageCache[id];
		if (entry.timestamp + EXPIRY_MS < Date.now()) {
			//Buttons are dropped rather than left to fail silently: the cache is in memory, so after this
			//point (or after a restart) a press would do nothing with no explanation.
			entry.msg.edit({components: []}).catch(() => {});
			delete messageCache[id];
		}
	}
}

setInterval(refresh, 10000);
