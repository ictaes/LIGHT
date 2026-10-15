import {TextChannel} from "discord.js";
import {client} from "../PointManager.js";
import {getOrderById, getDueClashes, resolveClash, ClashResult} from "./OrderUtil.js";
import {getServerContext} from "../BotSettingProvider.js";
import {createThemedEmbed, format} from "./EmbedUtil.js";

export async function announceClashResult(result: ClashResult) {
	const guild = client.guilds.cache.get(result.clash.guild);
	if (!guild) return;
	const orderA = getOrderById(result.clash.order_a);
	const orderB = getOrderById(result.clash.order_b);
	if (!orderA || !orderB) return;

	const description = result.winnerOrder === 0
		? `**${orderA.icon} ${orderA.name}** (${format(result.scoreA)}) vs **${orderB.icon} ${orderB.name}** (${format(result.scoreB)}) ended in a **draw**!`
		: `**${(result.winnerOrder === orderA.id ? orderA : orderB).icon} ${(result.winnerOrder === orderA.id ? orderA : orderB).name}** won the clash!\n${orderA.icon} ${orderA.name}: ${format(result.scoreA)}\n${orderB.icon} ${orderB.name}: ${format(result.scoreB)}`;

	const embed = createThemedEmbed(client.user!, "Clash ended").setDescription(description).toJSON();

	const settings = getServerContext(result.clash.guild);
	if (settings?.mod_log_channel_id) {
		const channel = guild.channels.cache.get(settings.mod_log_channel_id);
		if (channel instanceof TextChannel) channel.send({embeds: [embed]}).catch(() => {
		});
	}

	for (const leaderId of [orderA.leader, orderB.leader]) {
		const member = await guild.members.fetch(leaderId).catch(() => null);
		if (member) member.send({embeds: [embed]}).catch(() => {
		});
	}
}

async function checkClashes() {
	for (const clash of getDueClashes()) {
		try {
			const result = resolveClash(clash);
			await announceClashResult(result);
		} catch (e) {
			console.error(e);
		}
	}
}

setInterval(() => {
	checkClashes().catch(console.error);
}, 5000);
