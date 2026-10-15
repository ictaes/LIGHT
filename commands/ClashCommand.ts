import {ChatInputCommandInteraction, SlashCommandBuilder} from "discord.js";
import {PointCommand} from "../PointManager.js";
import {createConfirmationEmbed, createErrorEmbed, createThemedEmbed, format} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {parseDuration} from "./TimeoutCommand.js";
import {announceClashResult} from "../util/ClashScheduler.js";
import {
	declareClash,
	getActiveClashForOrder,
	getOrderByName,
	getOrderById,
	getOrderForMember,
	getLatestClashForOrder,
	hasOrderAccess,
	RaceType,
	resolveClash
} from "../util/OrderUtil.js";

const MIN_CLASH_MS = 10_000;
const MAX_CLASH_MS = 7 * 24 * 60 * 60 * 1000;

export default {
	requiresUser: true,
	slashData: new SlashCommandBuilder().setName("clash").setDescription("Declare and manage order clashes")
		.addSubcommand(sub => sub.setName("declare").setDescription("Declare a clash with another order")
			.addStringOption(option => option.setName("opponent").setDescription("The order to clash with").setRequired(true))
			.addStringOption(option => option.setName("duration").setDescription("How long the clash lasts (e.g. 10s, 5m, 2h, 1d)").setRequired(true))
			.addStringOption(option => option.setName("type").setDescription("What counts toward the score").setRequired(true).addChoices({name: "Points", value: "points"}, {name: "Wins", value: "wins"}, {name: "Both", value: "both"})))
		.addSubcommand(sub => sub.setName("end").setDescription("End your order's active clash early")
			.addStringOption(option => option.setName("name").setDescription("Your order's name (defaults to your own order)")))
		.addSubcommand(sub => sub.setName("info").setDescription("View an order's clash status")
			.addStringOption(option => option.setName("name").setDescription("The order to view (defaults to your own)"))),
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		const sub = interaction.options.getSubcommand();
		if (sub === "declare") return handleDeclare(context, interaction);
		if (sub === "end") return handleEnd(context, interaction);
		if (sub === "info") return handleInfo(context, interaction);
	}
} satisfies PointCommand;

async function handleDeclare(context: BotUserContext, interaction: ChatInputCommandInteraction) {
	const order = getOrderForMember(context.guild.id, context.id);
	if (!order || !hasOrderAccess(context.guild.id, context.id, order.id)) {
		await context.reply(createErrorEmbed(context.user, "❌ You need to be a leader or officer of an order to declare a clash!"));
		return;
	}
	const opponentName = interaction.options.getString("opponent", true);
	const opponent = getOrderByName(context.guild.id, opponentName);
	if (!opponent) {
		await context.reply(createErrorEmbed(context.user, "❌ No order with that name exists!"));
		return;
	}
	if (opponent.id === order.id) {
		await context.reply(createErrorEmbed(context.user, "❌ You can't declare a clash with your own order!"));
		return;
	}
	if (getActiveClashForOrder(order.id)) {
		await context.reply(createErrorEmbed(context.user, "❌ Your order is already in an active clash!"));
		return;
	}
	if (getActiveClashForOrder(opponent.id)) {
		await context.reply(createErrorEmbed(context.user, "❌ That order is already in an active clash!"));
		return;
	}
	const durationInput = interaction.options.getString("duration", true);
	const durationMs = parseDuration(durationInput);
	if (!durationMs || durationMs < MIN_CLASH_MS) {
		await context.reply(createErrorEmbed(context.user, "❌ Invalid duration! Must be a format like `10m`/`1h`/`1d`, and at least 10 seconds."));
		return;
	}
	const clampedMs = Math.min(durationMs, MAX_CLASH_MS);
	const raceType = interaction.options.getString("type", true) as RaceType;

	const clash = declareClash(context.guild.id, order.id, opponent.id, raceType, context.id, clampedMs);

	await context.reply({
		embeds: [
			createThemedEmbed(context.user, "Clash declared!")
				.setDescription(`${order.icon} **${order.name}** has declared a clash with ${opponent.icon} **${opponent.name}**!\n**Type:** ${raceType}\n**Ends:** <t:${Math.floor(clash.end_time / 1000)}:R>`).toJSON()
		]
	});

	for (const leaderId of [order.leader, opponent.leader]) {
		const member = await context.guild.members.fetch(leaderId).catch(() => null);
		if (member) member.send(`⚔ Clash declared between **${order.name}** and **${opponent.name}**! Ends <t:${Math.floor(clash.end_time / 1000)}:R>.`).catch(() => {
		});
	}
}

async function handleEnd(context: BotUserContext, interaction: ChatInputCommandInteraction) {
	const name = interaction.options.getString("name");
	const order = name ? getOrderByName(context.guild.id, name) : getOrderForMember(context.guild.id, context.id);
	if (!order) {
		await context.reply(createErrorEmbed(context.user, "❌ No order found!"));
		return;
	}
	if (!hasOrderAccess(context.guild.id, context.id, order.id)) {
		await context.reply(createErrorEmbed(context.user, "❌ You need to be a leader or officer of that order to end its clash!"));
		return;
	}
	const clash = getActiveClashForOrder(order.id);
	if (!clash) {
		await context.reply(createErrorEmbed(context.user, "❌ That order doesn't have an active clash!"));
		return;
	}
	const result = resolveClash(clash);
	await announceClashResult(result);
	await context.reply(createConfirmationEmbed(context.user, "✅ Clash ended early."));
}

async function handleInfo(context: BotUserContext, interaction: ChatInputCommandInteraction) {
	const name = interaction.options.getString("name");
	const order = name ? getOrderByName(context.guild.id, name) : getOrderForMember(context.guild.id, context.id);
	if (!order) {
		await context.reply(createErrorEmbed(context.user, name ? "❌ No order with that name exists!" : "❌ You're not in an order, and didn't specify one to view!"));
		return;
	}
	const active = getActiveClashForOrder(order.id);
	if (active) {
		const opponentId = active.order_a === order.id ? active.order_b : active.order_a;
		const opponent = getOrderById(opponentId);
		await context.reply({
			embeds: [
				createThemedEmbed(context.user, `${order.icon} ${order.name} — Active Clash`)
					.setDescription(`**Opponent:** ${opponent ? `${opponent.icon} ${opponent.name}` : "Unknown"}\n**Type:** ${active.race_type}\n**Ends:** <t:${Math.floor(active.end_time / 1000)}:R>`).toJSON()
			]
		});
		return;
	}
	const latest = getLatestClashForOrder(order.id);
	if (!latest || latest.winner_order === null) {
		await context.reply(createConfirmationEmbed(context.user, `${order.icon} **${order.name}** has no clash history yet.`));
		return;
	}
	const opponentId = latest.order_a === order.id ? latest.order_b : latest.order_a;
	const opponent = getOrderById(opponentId);
	const ownScore = latest.order_a === order.id ? latest.score_a : latest.score_b;
	const opponentScore = latest.order_a === order.id ? latest.score_b : latest.score_a;
	const resultText = latest.winner_order === 0 ? "Draw" : (latest.winner_order === order.id ? "Won" : "Lost");
	await context.reply({
		embeds: [
			createThemedEmbed(context.user, `${order.icon} ${order.name} — Last Clash`)
				.setDescription(`**Opponent:** ${opponent ? `${opponent.icon} ${opponent.name}` : "Unknown"}\n**Result:** ${resultText}\n**Score:** ${format(ownScore || 0)} - ${format(opponentScore || 0)}\n**Ended:** <t:${Math.floor((latest.resolved_at || 0) / 1000)}:R>`).toJSON()
		]
	});
}
