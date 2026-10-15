import {ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, Snowflake} from "discord.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {createErrorEmbed} from "../util/EmbedUtil.js";
import {updateSettings} from "../BotSettingProvider.js";
import {unsubscribe} from "../util/GameDataDistributor.js";
import {PointCommand} from "../PointManager.js";

export default {
	requiresUser: true,
	slashData: new SlashCommandBuilder().setName("unsubscribefeed").setDescription("UnSubscribe from a clan win feed")
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
	execute: async (context: BotUserContext) => {
		if (context.getSettings().webhooks.length === 0) {
			await context.reply(createErrorEmbed(context.user, "⚠ You are not subscribed to any feeds!"));
			return;
		}
		let rows = [];
		for (let i = 0; i < context.getSettings().webhooks.length; i += 5) {
			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				...context.getSettings().webhooks.slice(i, i + 5).map((webhook: { clan: string, channel: Snowflake }) => new ButtonBuilder().setStyle(ButtonStyle.Secondary).setCustomId(webhook.clan + " ".repeat(10) + webhook.channel).setLabel(webhook.clan))
			);
			rows.push(row);
		}
		let msg = await context.reply({
			embeds: [
				new EmbedBuilder().setAuthor(context.asAuthor()).setDescription("Please select the feed you want to unsubscribe from").setTimestamp().toJSON()
			],
			components: rows
		}).catch(() => {});
		if (!msg) return;

		if (!context.channel) return;
		const collector = context.channel.createMessageComponentCollector({time: 120000});
		collector.on("collect", async i => {
			if (!(i instanceof ButtonInteraction) || i.message.id !== msg.id || i.user.id !== context.user.id) return;
			await i.deferUpdate();
			const webhook = context.getSettings().webhooks.find((webhook: { clan: string, channel: Snowflake }) => webhook.clan + " ".repeat(10) + webhook.channel === i.customId);
			if (!webhook) return;
			context.getSettings().webhooks.splice(context.getSettings().webhooks.indexOf(webhook), 1);
			unsubscribe(webhook.clan, webhook.url);
			updateSettings();
			await msg.edit({
				embeds: [
					new EmbedBuilder().setAuthor(context.asAuthor()).setDescription(`Successfully unsubscribed from the clan win feed for \`${webhook.clan}\` in <#${webhook.channel}>!`).setTimestamp().toJSON()
				],
				components: []
			}).catch(() => {});
		});

		collector.on("end", async (collected, reason) => {
			try {
				reason === "time" && await msg.edit({components: []})
			} catch (e) {
			}
		});
	}
} as PointCommand;