import {ColorResolvable, EmbedBuilder, Guild, GuildBasedChannel, Snowflake, TextChannel} from "discord.js";
import * as db from "../db/DataBaseManager.js";
import {getServerContext} from "../BotSettingProvider.js";
import type {BotUserContext} from "./BotUserContext.js";

const database = db.getProvider();

//This module must not import PointManager, directly or transitively. It is what RewardManager and
//BotSettingProvider use for logging, and those are reached from PermissionUtil - so an import of PointManager
//here would mean that resolving a permission logs the bot in. That chain is exactly why logAction and
//logModAction were moved out of PointManager into this file.

/**
 * Log categories. `points` and `moderation` existed before this module under different names; the rest are
 * new destinations that previously all shared mod_log_channel_id.
 */
export type LogCategory =
	| "points"
	| "moderation"
	| "message"
	| "member"
	| "role"
	| "channel"
	| "voice"
	| "invite"
	| "emoji"
	| "webhook"
	| "antinuke";

export const LOG_CATEGORIES: LogCategory[] = [
	"points", "moderation", "message", "member", "role", "channel", "voice", "invite", "emoji", "webhook", "antinuke"
];

export const CATEGORY_DESCRIPTIONS: Record<LogCategory, string> = {
	points: "Point and economy changes",
	moderation: "Kicks, bans, timeouts, warnings and automod",
	message: "Message edits and deletions",
	member: "Joins, leaves, nickname and role changes",
	role: "Role creation, deletion and edits",
	channel: "Channel creation, deletion and edits",
	voice: "Voice channel joins, leaves and moves",
	invite: "Invite creation and deletion",
	emoji: "Emoji and sticker changes",
	webhook: "Webhook creation and deletion",
	antinuke: "Anti-nuke triggers and punishments"
};

/**
 * Which legacy settings.json field a category falls back to when it has no log_config row.
 *
 * This is what lets the ~20 existing call sites keep working untouched: a server that never configures
 * per-category routing behaves exactly as it did before.
 */
const LEGACY_FALLBACK: Record<LogCategory, "log_channel_id" | "mod_log_channel_id"> = {
	points: "log_channel_id",
	moderation: "mod_log_channel_id",
	message: "mod_log_channel_id",
	member: "mod_log_channel_id",
	role: "mod_log_channel_id",
	channel: "mod_log_channel_id",
	voice: "mod_log_channel_id",
	invite: "mod_log_channel_id",
	emoji: "mod_log_channel_id",
	webhook: "mod_log_channel_id",
	antinuke: "mod_log_channel_id"
};

export interface LogConfigRow {
	guild: Snowflake;
	category: string;
	channel: Snowflake;
	enabled: number;
	ignored_channels: string;
	ignored_roles: string;
	updated_by: Snowflake;
	updated_at: number;
}

export function getLogConfig(guild: Snowflake, category: LogCategory): LogConfigRow | undefined {
	return database.prepare<[Snowflake, string], LogConfigRow>("SELECT * FROM log_config WHERE guild = ? AND category = ?").get(guild, category);
}

export function getAllLogConfig(guild: Snowflake): LogConfigRow[] {
	return database.prepare<[Snowflake], LogConfigRow>("SELECT * FROM log_config WHERE guild = ? ORDER BY category").all(guild);
}

export function setLogChannel(guild: Snowflake, category: LogCategory, channel: Snowflake, updatedBy: Snowflake): void {
	database.prepare("INSERT INTO log_config (guild, category, channel, enabled, updated_by, updated_at) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT (guild, category) DO UPDATE SET channel = excluded.channel, enabled = 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
		.run(guild, category, channel, updatedBy, Date.now());
}

export function clearLogChannel(guild: Snowflake, category: LogCategory): boolean {
	return database.prepare("DELETE FROM log_config WHERE guild = ? AND category = ?").run(guild, category).changes > 0;
}

export function setLogEnabled(guild: Snowflake, category: LogCategory, enabled: boolean): boolean {
	return database.prepare("UPDATE log_config SET enabled = ? WHERE guild = ? AND category = ?").run(enabled ? 1 : 0, guild, category).changes > 0;
}

function parseIdList(json: string): Snowflake[] {
	try {
		const parsed = JSON.parse(json);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		//User-editable JSON in a text column; a malformed value must not take the log path down with it.
		return [];
	}
}

export function getIgnoredChannels(guild: Snowflake, category: LogCategory): Snowflake[] {
	const row = getLogConfig(guild, category);
	return row ? parseIdList(row.ignored_channels) : [];
}

/**
 * Resolves where a category's logs should go, or null if nowhere.
 *
 * Returns the configured channel if there is one and it is enabled, otherwise the legacy settings.json
 * channel for that category.
 */
export function resolveLogChannel(guild: Guild, category: LogCategory): TextChannel | null {
	const row = getLogConfig(guild.id, category);
	if (row) {
		if (!row.enabled) return null;
		const configured = guild.channels.cache.get(row.channel);
		if (configured instanceof TextChannel) return configured;
		//Falls through rather than returning null: a deleted log channel should not silently stop the
		//category logging when a usable legacy channel is still configured.
	}
	const setting = getServerContext(guild.id);
	if (!setting) return null;
	const legacy = setting[LEGACY_FALLBACK[category]];
	if (!legacy) return null;
	const channel = guild.channels.cache.get(legacy);
	return channel instanceof TextChannel ? channel : null;
}

/**
 * Is this channel somewhere the bot writes logs to?
 *
 * Message-event logging has to consult this before logging, or a deletion in the log channel is logged into
 * the log channel, and the bot spends the rest of its life talking to itself.
 */
export function isLogChannel(guild: Guild, channel: Snowflake): boolean {
	const configured = database.prepare<[Snowflake, Snowflake], { count: number }>("SELECT COUNT(*) AS count FROM log_config WHERE guild = ? AND channel = ?").get(guild.id, channel);
	if ((configured?.count ?? 0) > 0) return true;
	const setting = getServerContext(guild.id);
	if (!setting) return false;
	return setting.log_channel_id === channel || setting.mod_log_channel_id === channel;
}

/** True when this event should not be logged under this category at all. */
export function isIgnored(guild: Guild, category: LogCategory, channel: Snowflake | null): boolean {
	if (!channel) return false;
	if (category === "message" && isLogChannel(guild, channel)) return true;
	return getIgnoredChannels(guild.id, category).includes(channel);
}

/**
 * Sends a log embed. Fire-and-forget by design, matching the existing logAction/logModAction style: a log
 * that fails must never take down the action it was describing.
 */
export function emitLog(guild: Guild, category: LogCategory, embed: EmbedBuilder, sourceChannel: Snowflake | null = null): void {
	if (isIgnored(guild, category, sourceChannel)) return;
	const channel = resolveLogChannel(guild, category);
	if (!channel) return;
	channel.send({embeds: [embed.toJSON()]}).catch(console.error);
}

//Buffering was considered and deliberately left out for now. The case for it is a channel nuke producing
//dozens of embeds at once, but discord.js already serialises requests per route, so the result is slow
//logging rather than dropped logging. Revisit when antinuke lands, which is when bursts become routine.

/**
 * Logs a point-economy action. Behaviour is unchanged from the version that lived in PointManager, except
 * that the destination now goes through the `points` category first.
 */
export function logAction(context: BotUserContext, action: string, color: ColorResolvable): void {
	emitLog(context.guild, "points", baseEmbed(context, action, color));
}

/** Logs a moderation action. Unchanged behaviour, now routed through the `moderation` category. */
export function logModAction(context: BotUserContext, action: string, color: ColorResolvable): void {
	emitLog(context.guild, "moderation", baseEmbed(context, action, color));
}

function baseEmbed(context: BotUserContext, action: string, color: ColorResolvable): EmbedBuilder {
	return new EmbedBuilder()
		.setAuthor({name: context.user.tag, iconURL: context.user.displayAvatarURL()})
		.setDescription(action).setColor(color).setTimestamp();
}

/** Resolves a channel for the /logging command surface, which works with raw ids. */
export function asTextChannel(channel: GuildBasedChannel | undefined): TextChannel | null {
	return channel instanceof TextChannel ? channel : null;
}
