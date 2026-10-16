import * as fs from "fs";
import * as path from "path";
import {Snowflake} from "discord.js";
//Directly, rather than through PointManager's re-export: going via PointManager meant that reading a guild's
//settings booted the bot, which is what made PermissionUtil impossible to unit test.
import * as rewards from "./util/RewardManager.js";
//`import type`, not a plain import: BotUserContext imports PointManager, and only the type is needed here.
//A value import would re-create the cycle this file was just taken out of.
import type {LimitedServerSettings} from "./util/BotUserContext.js";
import {subscribe} from "./util/WebhookSubscriptions.js";

export interface MultiplierSetting {
	amount: number,
	end: number | null,
	description: string
};

export interface AutomodSetting {
	enabled: boolean,
	spam: { enabled: boolean, max_messages: number, interval_seconds: number } | null,
	links: { enabled: boolean, allow_invites: boolean, whitelist: string[] } | null,
	caps: { enabled: boolean, max_percent: number, min_length: number } | null,
	mention_spam: { enabled: boolean, max_mentions: number } | null,
	punishment: "delete" | "warn" | "timeout",
	timeout_seconds: number,
	exempt_roles: Snowflake[],
}

export interface EconomySetting {
	starting_balance: number,
	daily_amount: number,
	daily_cooldown_hours: number,
	work_min: number,
	work_max: number,
	work_cooldown_hours: number,
	max_bet: number | null,
}

export interface ServerSetting {
	roles: "all" | "highest",
	auto_points: boolean,
	readonly guild_id: Snowflake,
	tag: string | null,
	channel_id: Snowflake[],
	log_channel_id: string,
	update_channel_id: string,
	mod_roles: Snowflake[],
	rewards: { role_id: string, type: "points" | "wins", count: number }[],
	multiplier: MultiplierSetting | null,
	webhooks: { clan: string, url: string, channel: Snowflake }[],
	win_feed: Snowflake | null,
	claim_channel: Snowflake | null,
	claim_channel_description: string | null,
	factor_buttons: { name: string, factor: number }[],
	status: number, // first bit: 1 = points imported from 3rd party
	mod_log_channel_id: Snowflake | null,
	automod: AutomodSetting,
	economy: EconomySetting
}

const settingsPath = path.join(process.cwd(), "settings.json");

//Read at runtime rather than imported: a JSON import makes tsc emit the repo-root template ([]) over this file on every build, wiping every guild's settings
function readRawSettings(): Partial<ServerSetting>[] {
	try {
		return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw new Error(`Failed to read ${settingsPath}: ${(e as Error).message}`);
	}
}

const settings = readRawSettings().map((raw: Partial<ServerSetting>) => {
	if (!raw.guild_id) throw new Error("Found guild settings without a guild_id");
	return {...getDefaults(raw.guild_id), ...raw};
});
const indices: { [key: Snowflake]: number } = {};
const clanCache: { [key: string]: Snowflake[] } = {};

for (const i in settings) {
	indices[settings[i].guild_id] = parseInt(i);

	let tag = settings[i].tag;
	if (tag !== null) {
		if (!clanCache.hasOwnProperty(tag)) {
			clanCache[tag] = [];
		}
		clanCache[tag].push(settings[i].guild_id);
	}

	rewards.loadRewards(settings[i]);
	for (const webhook of settings[i].webhooks) {
		subscribe(webhook.clan, webhook.url);
	}
}

export function getDefaults(guild: Snowflake): ServerSetting {
	return {roles: "all", auto_points: false, guild_id: guild, tag: null, channel_id: [], log_channel_id: "", update_channel_id: "", mod_roles: [], rewards: [], multiplier: null, webhooks: [], win_feed: null, claim_channel: null, claim_channel_description: null, factor_buttons: [], status: 0, mod_log_channel_id: null, automod: {enabled: false, spam: null, links: null, caps: null, mention_spam: null, punishment: "delete", timeout_seconds: 600, exempt_roles: []}, economy: {starting_balance: 100, daily_amount: 50, daily_cooldown_hours: 24, work_min: 10, work_max: 40, work_cooldown_hours: 2, max_bet: 500}};
}

export function updateSettings() {
	fs.writeFile(settingsPath, JSON.stringify(settings, null, 4), (err) => {
		if (err) {
			console.error(err);
		}
	});
}

//TODO: Move the setting-handling part of BotUserContext here and make this private
export function getServerContext(guild: Snowflake): ServerSetting | null {
	if (indices.hasOwnProperty(guild)) {
		return settings[indices[guild]];
	}
	return null;
}

export function setServerSetting(setting: ServerSetting) {
	if (!indices.hasOwnProperty(setting.guild_id)) {
		indices[setting.guild_id] = Object.keys(indices).length;
		console.log(`Added new server ${setting.guild_id} at index ${settings.length}`);
	}
	settings[indices[setting.guild_id]] = setting;
	updateSettings();
}

export function removeServerSetting(guild: Snowflake) {
	if (indices.hasOwnProperty(guild)) {
		updateClanTag(settings[indices[guild]], null);
		settings.splice(indices[guild], 1);
		delete indices[guild];
		updateSettings();
		for (const i in settings) {
			indices[settings[i].guild_id] = parseInt(i);
		}
	}
}

export function updateClanTag(context: LimitedServerSettings, tag: string | null) {
	if (context.tag === tag) return;
	if (context.tag !== null && clanCache.hasOwnProperty(context.tag)) {
		clanCache[context.tag].splice(clanCache[context.tag].indexOf(context.guild_id), 1);
	}
	context.tag = tag;
	if (tag !== null) {
		if (!clanCache.hasOwnProperty(tag)) {
			clanCache[tag] = [];
		}
		clanCache[tag].push(context.guild_id);
	}
	updateSettings();
}

export function getGuildsForClan(clan: string): Snowflake[] {
	if (clanCache.hasOwnProperty(clan)) {
		return clanCache[clan];
	}
	return [];
}