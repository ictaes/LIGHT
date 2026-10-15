import {ChatInputCommandInteraction, Colors, EmbedBuilder, SlashCommandBuilder} from "discord.js";
import {PointCommand} from "../PointManager.js";
import {createConfirmationEmbed, createErrorEmbed, format} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {buyItem, getInventory, getItemByName, getItemsForGuild} from "../util/EconomyUtil.js";

export default {
	slashData: new SlashCommandBuilder().setName("shop").setDescription("Browse and buy shop items")
		.addSubcommand(sub => sub.setName("list").setDescription("List items available in the shop"))
		.addSubcommand(sub => sub.setName("buy").setDescription("Buy an item from the shop")
			.addStringOption(option => option.setName("item").setDescription("The item to buy").setRequired(true)))
		.addSubcommand(sub => sub.setName("inventory").setDescription("View your owned items")),
	requiresUser: true,
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		const sub = interaction.options.getSubcommand();
		if (sub === "list") return handleList(context);
		if (sub === "inventory") return handleInventory(context);
		return handleBuy(context, interaction);
	}
} satisfies PointCommand;

async function handleList(context: BotUserContext) {
	const items = getItemsForGuild(context.guild.id);
	if (items.length === 0) {
		await context.reply(createErrorEmbed(context.user, "❌ This shop has no items yet!"));
		return;
	}
	await context.reply({
		embeds: [
			new EmbedBuilder().setAuthor(context.asAuthor()).setTitle("Shop")
				.setDescription(items.map(item =>
					`**${item.name}** — ${format(item.price)} 🪙${item.stock !== null ? ` (${item.stock} left)` : ""}\n${item.description}${item.role_id ? ` — grants <@&${item.role_id}>` : ""}`
				).join("\n\n")).setColor(Colors.Blurple).setTimestamp().toJSON()
		]
	});
}

async function handleInventory(context: BotUserContext) {
	const inventory = getInventory(context.guild.id, context.id);
	if (inventory.length === 0) {
		await context.reply(createErrorEmbed(context.user, "❌ You don't own any items yet!"));
		return;
	}
	await context.reply({
		embeds: [
			new EmbedBuilder().setAuthor(context.asAuthor()).setTitle("Your inventory")
				.setDescription(inventory.map(row => `**${row.item.name}** x${row.quantity}`).join("\n")).setColor(Colors.Blurple).setTimestamp().toJSON()
		]
	});
}

async function handleBuy(context: BotUserContext, interaction: ChatInputCommandInteraction) {
	const name = interaction.options.getString("item", true);
	const item = getItemByName(context.guild.id, name);
	if (!item) {
		await context.reply(createErrorEmbed(context.user, `❌ No item named **${name}** exists in the shop!`));
		return;
	}
	const startingBalance = context.getSettings().economy.starting_balance;
	const result = buyItem(context.guild.id, context.id, item.id, startingBalance);
	if (result === "insufficient_funds") {
		await context.reply(createErrorEmbed(context.user, `❌ You don't have enough coins! **${item.name}** costs ${format(item.price)} 🪙.`));
		return;
	}
	if (result === "out_of_stock") {
		await context.reply(createErrorEmbed(context.user, `❌ **${item.name}** is out of stock!`));
		return;
	}
	if (result === "already_owned") {
		await context.reply(createErrorEmbed(context.user, `❌ You already own **${item.name}**!`));
		return;
	}
	if (result === "not_found") {
		await context.reply(createErrorEmbed(context.user, `❌ No item named **${name}** exists in the shop!`));
		return;
	}
	if (item.role_id && context.member) {
		await context.member.roles.add(item.role_id).catch(() => {
		});
	}
	await context.reply(createConfirmationEmbed(context.user, `✅ Bought **${item.name}** for ${format(item.price)} 🪙.`));
}
