import {Snowflake} from "discord.js";
import * as db from "../db/DataBaseManager.js";

const database = db.getProvider();

export interface PrefixConfigRow {
	guild: Snowflake;
	prefix: string;
	enabled: number;
}

export interface AliasRow {
	guild: Snowflake;
	alias: string;
	command: string;
}

export function getPrefixConfig(guild: Snowflake): PrefixConfigRow | undefined {
	return database.prepare<[Snowflake], PrefixConfigRow>("SELECT * FROM prefix_config WHERE guild = ?").get(guild);
}

export function setPrefix(guild: Snowflake, prefix: string): void {
	database.prepare("INSERT INTO prefix_config (guild, prefix, enabled) VALUES (?, ?, 1) ON CONFLICT(guild) DO UPDATE SET prefix = excluded.prefix, enabled = 1")
		.run(guild, prefix);
}

/** Returns false if the guild never had a custom prefix configured - nothing to disable. */
export function disablePrefix(guild: Snowflake): boolean {
	return database.prepare("UPDATE prefix_config SET enabled = 0 WHERE guild = ?").run(guild).changes > 0;
}

export function getAlias(guild: Snowflake, alias: string): string | undefined {
	const row = database.prepare<[Snowflake, string], { command: string }>("SELECT command FROM command_aliases WHERE guild = ? AND alias = ?").get(guild, alias);
	return row?.command;
}

export function getAllAliases(guild: Snowflake): AliasRow[] {
	return database.prepare<[Snowflake], AliasRow>("SELECT * FROM command_aliases WHERE guild = ? ORDER BY alias").all(guild);
}

export function addAlias(guild: Snowflake, alias: string, command: string): void {
	database.prepare("INSERT INTO command_aliases (guild, alias, command) VALUES (?, ?, ?) ON CONFLICT(guild, alias) DO UPDATE SET command = excluded.command")
		.run(guild, alias, command);
}

/** Returns false if the alias did not exist. */
export function removeAlias(guild: Snowflake, alias: string): boolean {
	return database.prepare("DELETE FROM command_aliases WHERE guild = ? AND alias = ?").run(guild, alias).changes > 0;
}
