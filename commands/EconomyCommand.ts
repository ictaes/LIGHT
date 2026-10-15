import {ChatInputCommandInteraction, Colors, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder} from "discord.js";
import {PointCommand} from "../PointManager.js";
import {updateSettings} from "../BotSettingProvider.js";
import {createConfirmationEmbed, createErrorEmbed, format} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import * as economy from "../util/EconomyUtil.js";

export default {
	slashData: new SlashCommandBuilder().setName("economy").setDescription("Configure the economy")
		.addSubcommand(sub => sub.setName("config").setDescription("Configure economy amounts and cooldowns")
			.addIntegerOption(option => option.setName("starting_balance").setDescription("Balance new members start with").setMinValue(0))
			.addIntegerOption(option => option.setName("daily_amount").setDescription("Amount granted by /daily").setMinValue(1))
			.addIntegerOption(option => option.setName("daily_cooldown_hours").setDescription("Cooldown for /daily in hours").setMinValue(1).setMaxValue(168))
			.addIntegerOption(option => option.setName("work_min").setDescription("Minimum payout for /work").setMinValue(0))
			.addIntegerOption(option => option.setName("work_max").setDescription("Maximum payout for /work").setMinValue(1))
			.addIntegerOption(option => option.setName("work_cooldown_hours").setDescription("Cooldown for /work in hours").setMinValue(1).setMaxValue(168))
			.addIntegerOption(option => option.setName("max_bet").setDescription("Max bet allowed for gambling commands (0 = no limit)").setMinValue(0)))
		.addSubcommand(sub => sub.setName("additem").setDescription("Add a shop item")
			.addStringOption(option => option.setName("name").setDescription("Item name").setRequired(true))
			.addStringOption(option => option.setName("description").setDescription("Item description").setRequired(true))
			.addIntegerOption(option => option.setName("price").setDescription("Item price").setRequired(true).setMinValue(1))
			.addRoleOption(option => option.setName("role").setDescription("Role to grant on purchase"))
			.addIntegerOption(option => option.setName("stock").setDescription("Limited stock count (omit for unlimited)").setMinValue(0)))
		.addSubcommand(sub => sub.setName("removeitem").setDescription("Remove a shop item")
			.addStringOption(option => option.setName("name").setDescription("Item name").setRequired(true)))
		.addSubcommand(sub => sub.setName("edititem").setDescription("Edit a shop item")
			.addStringOption(option => option.setName("name").setDescription("Item name").setRequired(true))
			.addStringOption(option => option.setName("description").setDescription("New description"))
			.addIntegerOption(option => option.setName("price").setDescription("New price").setMinValue(1))
			.addRoleOption(option => option.setName("role").setDescription("New role to grant on purchase"))
			.addIntegerOption(option => option.setName("stock").setDescription("New stock count").setMinValue(0)))
		.addSubcommand(sub => sub.setName("setbalance").setDescription("Set a member's balance")
			.addUserOption(option => option.setName("member").setDescription("The member to modify").setRequired(true))
			.addIntegerOption(option => option.setName("amount").setDescription("The balance to set").setRequired(true).setMinValue(0)))
		.addSubcommand(sub => sub.setName("show").setDescription("Show the current economy configuration"))
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
	requiresUser: true,
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		if (!context.hasModAccess()) {
			await context.reply(createErrorEmbed(context.user, "❌ You don't have permission to configure the economy!"));
			return;
		}
		const sub = interaction.options.getSubcommand();
		const settings = context.getSettings().economy;

		if (sub === "config") {
			settings.starting_balance = interaction.options.getInteger("starting_balance") ?? settings.starting_balance;
			settings.daily_amount = interaction.options.getInteger("daily_amount") ?? settings.daily_amount;
			settings.daily_cooldown_hours = interaction.options.getInteger("daily_cooldown_hours") ?? settings.daily_cooldown_hours;
			settings.work_min = interaction.options.getInteger("work_min") ?? settings.work_min;
			settings.work_max = interaction.options.getInteger("work_max") ?? settings.work_max;
			settings.work_cooldown_hours = interaction.options.getInteger("work_cooldown_hours") ?? settings.work_cooldown_hours;
			const maxBet = interaction.options.getInteger("max_bet");
			if (maxBet !== null) settings.max_bet = maxBet === 0 ? null : maxBet;
			if (settings.work_min > settings.work_max) {
				await context.reply(createErrorEmbed(context.user, "⚠ work_min can't be greater than work_max!"));
				return;
			}
		} else if (sub === "additem") {
			const name = interaction.options.getString("name", true);
			if (economy.getItemByName(context.guild.id, name)) {
				await context.reply(createErrorEmbed(context.user, `❌ An item named **${name}** already exists!`));
				return;
			}
			const description = interaction.options.getString("description", true);
			const price = interaction.options.getInteger("price", true);
			const role = interaction.options.getRole("role");
			const stock = interaction.options.getInteger("stock");
			economy.createItem(context.guild.id, name, description, price, role?.id ?? null, stock);
			await context.reply(createConfirmationEmbed(context.user, `✅ Added **${name}** to the shop for ${format(price)} 🪙.`));
			return;
		} else if (sub === "removeitem") {
			const name = interaction.options.getString("name", true);
			const item = economy.getItemByName(context.guild.id, name);
			if (!item) {
				await context.reply(createErrorEmbed(context.user, `❌ No item named **${name}** exists!`));
				return;
			}
			economy.deleteItem(item.id);
			await context.reply(createConfirmationEmbed(context.user, `✅ Removed **${name}** from the shop.`));
			return;
		} else if (sub === "edititem") {
			const name = interaction.options.getString("name", true);
			const item = economy.getItemByName(context.guild.id, name);
			if (!item) {
				await context.reply(createErrorEmbed(context.user, `❌ No item named **${name}** exists!`));
				return;
			}
			const description = interaction.options.getString("description");
			const price = interaction.options.getInteger("price");
			const role = interaction.options.getRole("role");
			const stock = interaction.options.getInteger("stock");
			economy.updateItem(item.id, {
				description: description ?? undefined,
				price: price ?? undefined,
				role_id: role ? role.id : undefined,
				stock: stock ?? undefined
			});
			await context.reply(createConfirmationEmbed(context.user, `✅ Updated **${name}**.`));
			return;
		} else if (sub === "setbalance") {
			const user = interaction.options.getUser("member", true);
			const amount = interaction.options.getInteger("amount", true);
			economy.setBalance(context.guild.id, user.id, amount, settings.starting_balance);
			await context.reply(createConfirmationEmbed(context.user, `✅ Set ${user}'s balance to ${format(amount)} 🪙.`));
			return;
		} else if (sub === "show") {
			const items = economy.getItemsForGuild(context.guild.id);
			await context.reply({
				embeds: [
					new EmbedBuilder().setAuthor(context.asAuthor()).setTitle("Economy configuration")
						.setDescription([
							`**Starting balance:** ${format(settings.starting_balance)} 🪙`,
							`**Daily:** ${format(settings.daily_amount)} 🪙 every ${settings.daily_cooldown_hours}h`,
							`**Work:** ${format(settings.work_min)}-${format(settings.work_max)} 🪙 every ${settings.work_cooldown_hours}h`,
							`**Max bet:** ${settings.max_bet !== null ? format(settings.max_bet) + " 🪙" : "no limit"}`,
							`**Shop items:** ${items.length === 0 ? "none" : items.map(i => `${i.name} (${format(i.price)} 🪙${i.stock !== null ? `, stock ${i.stock}` : ""})`).join(", ")}`
						].join("\n")).setColor(Colors.Blurple).setTimestamp().toJSON()
				]
			});
			return;
		}
		updateSettings();
		await context.reply(createConfirmationEmbed(context.user, "✅ Economy settings updated."));
	}
} as PointCommand;
