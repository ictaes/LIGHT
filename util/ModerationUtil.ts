import {Guild, Snowflake, TextChannel} from "discord.js";
import * as db from "../db/DataBaseManager.js";
import {BotUserContext} from "./BotUserContext.js";
import {getServerContext} from "../BotSettingProvider.js";

const database = db.getProvider();

export interface WarningRow {
	id: number,
	guild: Snowflake,
	member: Snowflake,
	moderator: Snowflake,
	reason: string,
	created_at: number
}

export function addWarning(guild: Snowflake, member: Snowflake, moderator: Snowflake, reason: string): number {
	database.prepare("INSERT INTO warnings (guild, member, moderator, reason, created_at) VALUES (?, ?, ?, ?, ?)").run(guild, member, moderator, reason, Date.now());
	const row = database.prepare<[Snowflake, Snowflake], { count: number }>("SELECT COUNT(*) AS count FROM warnings WHERE guild = ? AND member = ?").get(guild, member);
	return row ? row.count : 0;
}

export function getWarnings(guild: Snowflake, member: Snowflake): WarningRow[] {
	return database.prepare<[Snowflake, Snowflake], WarningRow>("SELECT * FROM warnings WHERE guild = ? AND member = ? ORDER BY created_at DESC").all(guild, member);
}

export function clearWarning(id: number) {
	database.prepare("DELETE FROM warnings WHERE id = ?").run(id);
}

export function clearAllWarnings(guild: Snowflake, member: Snowflake): number {
	return database.prepare("DELETE FROM warnings WHERE guild = ? AND member = ?").run(guild, member).changes;
}

export function recordModAction(guild: Snowflake, member: Snowflake, moderator: Snowflake, action: string, reason: string, duration: number | null = null) {
	database.prepare("INSERT INTO mod_actions (guild, member, moderator, action, reason, duration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(guild, member, moderator, action, reason, duration, Date.now());
}

export function getModLogChannelForGuild(guild: Guild): TextChannel | null {
	const setting = getServerContext(guild.id);
	if (!setting || !setting.mod_log_channel_id) return null;
	const channel = guild.channels.cache.get(setting.mod_log_channel_id);
	if (!(channel instanceof TextChannel)) return null;
	return channel;
}

export function getModLogChannel(context: BotUserContext): TextChannel | null {
	return getModLogChannelForGuild(context.guild);
}
