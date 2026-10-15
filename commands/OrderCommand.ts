import {ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, GuildMember, SlashCommandBuilder} from "discord.js";
import {PointCommand} from "../PointManager.js";
import {createConfirmationEmbed, createErrorEmbed, createThemedEmbed, format} from "../util/EmbedUtil.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {
	addOrderMember,
	createOrder,
	deleteOrder,
	getActiveClashForOrder,
	getOrderByName,
	getOrderForMember,
	getOrderLeaderboard,
	getOrderMembers,
	getOrdersForGuild,
	hasOrderAccess,
	isOrderLeader,
	removeOrderMember,
	setOrderOfficer,
	updateOrder
} from "../util/OrderUtil.js";

export default {
	requiresUser: true,
	slashData: new SlashCommandBuilder().setName("order").setDescription("Manage orders (team groupings) in this server")
		.addSubcommand(sub => sub.setName("create").setDescription("Create a new order")
			.addStringOption(option => option.setName("name").setDescription("The order's name").setRequired(true))
			.addStringOption(option => option.setName("icon").setDescription("An emoji to represent the order").setRequired(true))
			.addStringOption(option => option.setName("description").setDescription("A short description").setRequired(true))
			.addUserOption(option => option.setName("leader").setDescription("The order's leader").setRequired(true)))
		.addSubcommand(sub => sub.setName("join").setDescription("Join an order")
			.addStringOption(option => option.setName("name").setDescription("The order to join").setRequired(true)))
		.addSubcommand(sub => sub.setName("leave").setDescription("Leave your current order"))
		.addSubcommand(sub => sub.setName("info").setDescription("View an order's info")
			.addStringOption(option => option.setName("name").setDescription("The order to view (defaults to your own)")))
		.addSubcommand(sub => sub.setName("list").setDescription("List all orders in this server")
			.addIntegerOption(option => option.setName("page").setDescription("The page to view")))
		.addSubcommand(sub => sub.setName("leaderboard").setDescription("View an order's leaderboard")
			.addStringOption(option => option.setName("name").setDescription("The order to view").setRequired(true))
			.addIntegerOption(option => option.setName("type").setDescription("Type of leaderboard").addChoices({name: "Points", value: 0}, {name: "Wins", value: 1})))
		.addSubcommand(sub => sub.setName("promote").setDescription("Promote or demote a member of your order to/from officer")
			.addUserOption(option => option.setName("member").setDescription("The member to promote/demote").setRequired(true)))
		.addSubcommand(sub => sub.setName("edit").setDescription("Edit your order (leader only)")
			.addStringOption(option => option.setName("name").setDescription("New name"))
			.addStringOption(option => option.setName("icon").setDescription("New icon emoji"))
			.addStringOption(option => option.setName("description").setDescription("New description"))
			.addRoleOption(option => option.setName("member_role").setDescription("Role given to all members"))
			.addRoleOption(option => option.setName("officer_role").setDescription("Role given to officers"))
			.addRoleOption(option => option.setName("leader_role").setDescription("Role given to the leader"))
			.addUserOption(option => option.setName("transfer_leader").setDescription("Transfer leadership to this member (must already be in the order)")))
		.addSubcommand(sub => sub.setName("disband").setDescription("Disband your order")),
	execute: async (context: BotUserContext) => {
		const interaction = context.base as ChatInputCommandInteraction;
		const sub = interaction.options.getSubcommand();
		if (sub === "create") return handleCreate(context, interaction);
		if (sub === "join") return handleJoin(context, interaction);
		if (sub === "leave") return handleLeave(context);
		if (sub === "info") return handleInfo(context, interaction);
		if (sub === "list") return handleList(context, interaction.options.getInteger("page") || 1);
		if (sub === "leaderboard") return handleLeaderboard(context, interaction);
		if (sub === "promote") return handlePromote(context, interaction);
		if (sub === "edit") return handleEdit(context, interaction);
		if (sub === "disband") return handleDisband(context);
	}
} as PointCommand;

async function handleCreate(context: BotUserContext, interaction: ChatInputCommandInteraction) {
	if (!context.hasModAccess()) {
		await context.reply(createErrorEmbed(context.user, "❌ You don't have permission to create orders!"));
		return;
	}
	const name = interaction.options.getString("name", true);
	const icon = interaction.options.getString("icon", true);
	const description = interaction.options.getString("description", true);
	const leader = interaction.options.getUser("leader", true);
	if (getOrderByName(context.guild.id, name)) {
		await context.reply(createErrorEmbed(context.user, "❌ An order with that name already exists!"));
		return;
	}
	if (getOrderForMember(context.guild.id, leader.id)) {
		await context.reply(createErrorEmbed(context.user, "❌ That user is already in an order!"));
		return;
	}
	const order = createOrder(context.guild.id, name, icon, description, leader.id);
	await context.reply(createConfirmationEmbed(context.user, `✅ Created order ${icon} **${name}** led by ${leader}! (id #${order.id})`));
}

async function handleJoin(context: BotUserContext, interaction: ChatInputCommandInteraction) {
	const name = interaction.options.getString("name", true);
	const order = getOrderByName(context.guild.id, name);
	if (!order) {
		await context.reply(createErrorEmbed(context.user, "❌ No order with that name exists!"));
		return;
	}
	if (getOrderForMember(context.guild.id, context.id)) {
		await context.reply(createErrorEmbed(context.user, "❌ You're already in an order! Leave it first with `/order leave`."));
		return;
	}
	addOrderMember(context.guild.id, context.id, order.id);
	if (order.member_role) {
		await context.fetchMember();
		if (context.member instanceof GuildMember) await context.member.roles.add(order.member_role).catch(() => {
		});
	}
	await context.reply(createConfirmationEmbed(context.user, `✅ You joined ${order.icon} **${order.name}**!`));
}

async function handleLeave(context: BotUserContext) {
	const order = getOrderForMember(context.guild.id, context.id);
	if (!order) {
		await context.reply(createErrorEmbed(context.user, "❌ You're not in an order!"));
		return;
	}
	if (isOrderLeader(context.guild.id, context.id, order.id)) {
		await context.reply(createErrorEmbed(context.user, "❌ You're the leader! Transfer leadership with `/order edit transfer_leader` or disband the order with `/order disband` first."));
		return;
	}
	removeOrderMember(context.guild.id, context.id);
	await context.fetchMember();
	if (context.member instanceof GuildMember) {
		if (order.member_role) await context.member.roles.remove(order.member_role).catch(() => {
		});
		if (order.officer_role) await context.member.roles.remove(order.officer_role).catch(() => {
		});
	}
	await context.reply(createConfirmationEmbed(context.user, `✅ You left ${order.icon} **${order.name}**!`));
}

async function handleInfo(context: BotUserContext, interaction: ChatInputCommandInteraction) {
	const name = interaction.options.getString("name");
	const order = name ? getOrderByName(context.guild.id, name) : getOrderForMember(context.guild.id, context.id);
	if (!order) {
		await context.reply(createErrorEmbed(context.user, name ? "❌ No order with that name exists!" : "❌ You're not in an order, and didn't specify one to view!"));
		return;
	}
	const members = getOrderMembers(order.id);
	const officers = members.filter(m => m.officer === 1 && m.member !== order.leader);
	const clash = getActiveClashForOrder(order.id);
	await context.reply({
		embeds: [
			createThemedEmbed(context.user, `${order.icon} ${order.name}`)
				.setDescription(order.description)
				.addFields(
					{name: "Leader", value: `<@${order.leader}>`, inline: true},
					{name: "Officers", value: officers.length === 0 ? "None" : officers.map(m => `<@${m.member}>`).join("\n"), inline: true},
					{name: "Members", value: `${members.length}`, inline: true},
					{name: "Active clash", value: clash ? `vs order #${clash.order_a === order.id ? clash.order_b : clash.order_a}, ends <t:${Math.floor(clash.end_time / 1000)}:R>` : "None"}
				).toJSON()
		]
	});
}

async function handleList(context: BotUserContext, page: number) {
	const orders = getOrdersForGuild(context.guild.id);
	const perPage = 10;
	const max = Math.max(1, Math.ceil(orders.length / perPage));
	page = Math.max(1, Math.min(page, max));
	const pageOrders = orders.slice((page - 1) * perPage, page * perPage);
	const msg = await context.reply({
		embeds: [
			createThemedEmbed(context.user, "Orders")
				.setDescription(pageOrders.length === 0 ? "No orders have been created yet." : pageOrders.map(o => `${o.icon} **${o.name}** — led by <@${o.leader}>`).join("\n"))
				.setFooter({text: `Page ${page}/${max}`}).toJSON()
		],
		components: [
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId("previous").setEmoji("⬅").setStyle(ButtonStyle.Primary).setDisabled(page === 1),
				new ButtonBuilder().setCustomId("next").setEmoji("➡").setStyle(ButtonStyle.Primary).setDisabled(page === max)
			)
		]
	});

	if (!context.channel) return;
	const collector = context.channel.createMessageComponentCollector({time: 60000});
	collector.on("collect", async i => {
		if (!(i instanceof ButtonInteraction) || i.message.id !== msg.id || i.user.id !== context.user.id) return;
		await i.deferUpdate();
		collector.stop();
		await handleList(context, i.customId === "next" ? page + 1 : page - 1);
	});
	collector.on("end", async (collected, reason) => {
		try {
			reason === "time" && await msg.edit({components: []});
		} catch (e) {
		}
	});
}

async function handleLeaderboard(context: BotUserContext, interaction: ChatInputCommandInteraction) {
	const name = interaction.options.getString("name", true);
	const wins = (interaction.options.getInteger("type") || 0) === 1;
	const order = getOrderByName(context.guild.id, name);
	if (!order) {
		await context.reply(createErrorEmbed(context.user, "❌ No order with that name exists!"));
		return;
	}
	const leaderboard = getOrderLeaderboard(order.id, wins);
	await context.reply({
		embeds: [
			createThemedEmbed(context.user, `${order.icon} ${order.name} — ${wins ? "Wins" : "Points"} Leaderboard`)
				.setDescription(leaderboard.length === 0 ? "No members yet." : leaderboard.slice(0, 15).map((entry, index) => `${index + 1}. <@${entry.member}> • ${format(entry.value)}`).join("\n")).toJSON()
		]
	});
}

async function handlePromote(context: BotUserContext, interaction: ChatInputCommandInteraction) {
	const order = getOrderForMember(context.guild.id, context.id);
	if (!order || !hasOrderAccess(context.guild.id, context.id, order.id)) {
		await context.reply(createErrorEmbed(context.user, "❌ You need to be a leader or officer of an order to do that!"));
		return;
	}
	const target = interaction.options.getUser("member", true);
	const targetOrder = getOrderForMember(context.guild.id, target.id);
	if (!targetOrder || targetOrder.id !== order.id) {
		await context.reply(createErrorEmbed(context.user, "❌ That member isn't in your order!"));
		return;
	}
	const promoting = !targetOrder.officer;
	setOrderOfficer(context.guild.id, target.id, promoting);
	if (order.officer_role) {
		const member = await context.guild.members.fetch(target.id).catch(() => null);
		if (member) await (promoting ? member.roles.add(order.officer_role) : member.roles.remove(order.officer_role)).catch(() => {
		});
	}
	await context.reply(createConfirmationEmbed(context.user, `✅ ${promoting ? "Promoted" : "Demoted"} ${target} ${promoting ? "to" : "from"} officer!`));
}

async function handleEdit(context: BotUserContext, interaction: ChatInputCommandInteraction) {
	const order = getOrderForMember(context.guild.id, context.id);
	if (!order || !isOrderLeader(context.guild.id, context.id, order.id)) {
		await context.reply(createErrorEmbed(context.user, "❌ Only the leader of an order can edit it!"));
		return;
	}
	const name = interaction.options.getString("name");
	const icon = interaction.options.getString("icon");
	const description = interaction.options.getString("description");
	const memberRole = interaction.options.getRole("member_role");
	const officerRole = interaction.options.getRole("officer_role");
	const leaderRole = interaction.options.getRole("leader_role");
	const transferLeader = interaction.options.getUser("transfer_leader");

	if (!name && !icon && !description && !memberRole && !officerRole && !leaderRole && !transferLeader) {
		await context.reply(createErrorEmbed(context.user, "❌ You need to provide at least one field to edit!"));
		return;
	}
	if (name && name !== order.name && getOrderByName(context.guild.id, name)) {
		await context.reply(createErrorEmbed(context.user, "❌ An order with that name already exists!"));
		return;
	}
	if (transferLeader) {
		const newLeaderOrder = getOrderForMember(context.guild.id, transferLeader.id);
		if (!newLeaderOrder || newLeaderOrder.id !== order.id) {
			await context.reply(createErrorEmbed(context.user, "❌ The new leader needs to already be a member of this order!"));
			return;
		}
	}

	updateOrder(order.id, {
		name: name || undefined, icon: icon || undefined, description: description || undefined,
		member_role: memberRole ? memberRole.id : undefined, officer_role: officerRole ? officerRole.id : undefined,
		leader_role: leaderRole ? leaderRole.id : undefined, leader: transferLeader ? transferLeader.id : undefined
	});

	if (leaderRole) {
		const leaderMember = await context.guild.members.fetch(transferLeader ? transferLeader.id : order.leader).catch(() => null);
		if (leaderMember) await leaderMember.roles.add(leaderRole.id).catch(() => {
		});
	}
	if (transferLeader) {
		setOrderOfficer(context.guild.id, transferLeader.id, true);
		if (order.leader_role) {
			const oldLeaderMember = await context.guild.members.fetch(order.leader).catch(() => null);
			if (oldLeaderMember) await oldLeaderMember.roles.remove(order.leader_role).catch(() => {
			});
		}
	}

	await context.reply(createConfirmationEmbed(context.user, "✅ Order updated!"));
}

async function handleDisband(context: BotUserContext) {
	const order = getOrderForMember(context.guild.id, context.id);
	if (!order) {
		await context.reply(createErrorEmbed(context.user, "❌ You're not in an order!"));
		return;
	}
	if (!isOrderLeader(context.guild.id, context.id, order.id) && !context.hasModAccess()) {
		await context.reply(createErrorEmbed(context.user, "❌ Only the leader (or a mod) can disband an order!"));
		return;
	}
	if (getActiveClashForOrder(order.id)) {
		await context.reply(createErrorEmbed(context.user, "❌ This order has an active clash! End it first with `/clash end`."));
		return;
	}
	const members = getOrderMembers(order.id);
	for (const m of members) {
		const member = await context.guild.members.fetch(m.member).catch(() => null);
		if (member) {
			if (order.member_role) await member.roles.remove(order.member_role).catch(() => {
			});
			if (order.officer_role) await member.roles.remove(order.officer_role).catch(() => {
			});
			if (order.leader_role) await member.roles.remove(order.leader_role).catch(() => {
			});
		}
	}
	deleteOrder(order.id);
	await context.reply(createConfirmationEmbed(context.user, `✅ Disbanded ${order.icon} **${order.name}**.`));
}
