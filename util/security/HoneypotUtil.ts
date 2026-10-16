import {Colors, EmbedBuilder, GuildMember, Message, PermissionFlagsBits, Snowflake, TextChannel} from "discord.js";
import * as db from "../../db/DataBaseManager.js";
import {config} from "../../Config.js";
import {hasPermission} from "../PermissionUtil.js";
import {getModLogChannelForGuild, recordModAction} from "../ModerationUtil.js";

const database = db.getProvider();

export type HoneypotAction = "ban" | "kick" | "timeout";

export const HONEYPOT_ACTIONS: HoneypotAction[] = ["ban", "kick", "timeout"];

export interface HoneypotChannelRow {
	guild: Snowflake;
	channel: Snowflake;
	action: HoneypotAction;
	timeout_duration: number | null;
	delete_message_seconds: number;
	enabled: number;
	created_by: Snowflake;
	created_at: number;
}

export interface HoneypotHitRow {
	id: number;
	guild: Snowflake;
	channel: Snowflake;
	member: Snowflake;
	content: string | null;
	action: string;
	succeeded: number;
	error: string | null;
	created_at: number;
}

/** Discord's own cap on a timeout. */
export const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

export function getChannel(guild: Snowflake, channel: Snowflake): HoneypotChannelRow | undefined {
	return database.prepare<[Snowflake, Snowflake], HoneypotChannelRow>("SELECT * FROM honeypot_channels WHERE guild = ? AND channel = ?").get(guild, channel);
}

export function listChannels(guild: Snowflake): HoneypotChannelRow[] {
	return database.prepare<[Snowflake], HoneypotChannelRow>("SELECT * FROM honeypot_channels WHERE guild = ? ORDER BY created_at").all(guild);
}

export function addChannel(guild: Snowflake, channel: Snowflake, action: HoneypotAction, timeoutDuration: number | null, deleteMessageSeconds: number, createdBy: Snowflake): void {
	database.prepare("INSERT INTO honeypot_channels (guild, channel, action, timeout_duration, delete_message_seconds, enabled, created_by, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT (guild, channel) DO UPDATE SET action = excluded.action, timeout_duration = excluded.timeout_duration, delete_message_seconds = excluded.delete_message_seconds, enabled = 1, created_by = excluded.created_by, created_at = excluded.created_at")
		.run(guild, channel, action, timeoutDuration, deleteMessageSeconds, createdBy, Date.now());
}

export function removeChannel(guild: Snowflake, channel: Snowflake): boolean {
	return database.prepare("DELETE FROM honeypot_channels WHERE guild = ? AND channel = ?").run(guild, channel).changes > 0;
}

export function setEnabled(guild: Snowflake, channel: Snowflake, enabled: boolean): boolean {
	return database.prepare("UPDATE honeypot_channels SET enabled = ? WHERE guild = ? AND channel = ?").run(enabled ? 1 : 0, guild, channel).changes > 0;
}

export function getHits(guild: Snowflake, limit: number = 10): HoneypotHitRow[] {
	return database.prepare<[Snowflake, number], HoneypotHitRow>("SELECT * FROM honeypot_hits WHERE guild = ? ORDER BY created_at DESC LIMIT ?").all(guild, limit);
}

function recordHit(guild: Snowflake, channel: Snowflake, member: Snowflake, content: string, action: string, succeeded: boolean, error: string | null): void {
	//Content is truncated rather than stored whole: honeypot bait is usually a scam link plus a wall of
	//mention spam, and the database is not the place for it.
	database.prepare("INSERT INTO honeypot_hits (guild, channel, member, content, action, succeeded, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
		.run(guild, channel, member, content.slice(0, 500), action, succeeded ? 1 : 0, error, Date.now());
}

export type ExemptionReason = "bot" | "self" | "owner" | "bot_owner" | "moderator" | null;

/**
 * Why a member would not be punished for posting in a honeypot.
 *
 * The moderator exemption is the important one. The single most likely real-world incident with this feature
 * is a moderator posting in a bait channel - to test it, or by misclicking the channel list - and a honeypot
 * that bans its own staff does more damage than the raid it was meant to stop.
 */
export function getExemption(member: GuildMember): ExemptionReason {
	if (member.user.bot) return "bot";
	if (member.id === member.client.user.id) return "self";
	if (member.id === member.guild.ownerId) return "owner";
	if (member.id === config.bot_owner) return "bot_owner";
	if (hasPermission(member, "moderate_members")) return "moderator";
	return null;
}

export interface HoneypotResult {
	triggered: boolean;
	exemption?: ExemptionReason;
	action?: HoneypotAction;
	succeeded?: boolean;
	error?: string;
}

/**
 * Handles a message that may have landed in a honeypot channel. Returns whether the honeypot claimed it, so
 * the caller can stop processing the message as normal content.
 *
 * Deliberately takes a raw Message and not a BotUserContext: a guild that has never been through /setup has
 * no context, and a honeypot that stops working because the server was not configured for points would be a
 * trap that silently disarms itself.
 */
export async function handleMessage(message: Message): Promise<HoneypotResult> {
	if (!message.guild || !(message.member instanceof GuildMember)) return {triggered: false};

	const row = getChannel(message.guild.id, message.channelId);
	if (!row || !row.enabled) return {triggered: false};

	const exemption = getExemption(message.member);
	if (exemption) return {triggered: false, exemption};

	const member = message.member;
	const content = message.content || "(no text content)";
	let succeeded = false;
	let error: string | null = null;

	try {
		//Checked before acting so the failure is reported as a configuration problem rather than as a vague
		//"Missing Permissions" from the API.
		const required = row.action === "ban" ? PermissionFlagsBits.BanMembers
			: row.action === "kick" ? PermissionFlagsBits.KickMembers
				: PermissionFlagsBits.ModerateMembers;
		if (!message.guild.members.me?.permissions.has(required)) {
			throw new Error(`the bot is missing the permission needed to ${row.action}`);
		}
		//Role hierarchy, not just permissions: Discord refuses to act on anyone whose highest role is at or
		//above the bot's. Checked up front so the recorded failure says which problem it was, instead of a
		//bare "Missing Permissions" that is equally consistent with the bot lacking the permission entirely.
		if (row.action === "ban" ? !member.bannable : !member.manageable) {
			throw new Error("the target's highest role is at or above the bot's");
		}

		switch (row.action) {
			case "ban":
				//deleteMessageSeconds removes the bait post as part of the ban. Doing it in one call avoids a
				//separate delete that races the ban and fails with "Unknown Message".
				await message.guild.bans.create(member.id, {
					reason: `Honeypot: posted in #${(message.channel as TextChannel).name}`,
					deleteMessageSeconds: row.delete_message_seconds
				});
				break;
			case "kick":
				await deleteBait(message);
				await member.kick(`Honeypot: posted in #${(message.channel as TextChannel).name}`);
				break;
			case "timeout":
				await deleteBait(message);
				await member.timeout(row.timeout_duration ?? 60 * 60 * 1000, `Honeypot: posted in #${(message.channel as TextChannel).name}`);
				break;
		}
		succeeded = true;
	} catch (e) {
		error = e instanceof Error ? e.message : String(e);
		console.error(`Honeypot ${row.action} failed in ${message.guild.id}:`, e);
	}

	recordHit(message.guild.id, message.channelId, member.id, content, row.action, succeeded, error);
	if (succeeded) {
		recordModAction(message.guild.id, member.id, message.client.user.id, row.action, "Honeypot trigger", row.action === "timeout" ? row.timeout_duration : null);
	}
	await announce(message, row, member, succeeded, error);

	return {triggered: true, action: row.action, succeeded, error: error ?? undefined};
}

/** A ban with deleteMessageSeconds already removes the message, so only the other actions delete it here. */
async function deleteBait(message: Message): Promise<void> {
	if (!message.deletable) return;
	await message.delete().catch(() => {
		//Non-fatal: the punishment matters more than the message, and losing the race to another bot's
		//automod is normal.
	});
}

async function announce(message: Message, row: HoneypotChannelRow, member: GuildMember, succeeded: boolean, error: string | null): Promise<void> {
	if (!message.guild) return;
	const channel = getModLogChannelForGuild(message.guild);
	if (!channel) return;
	const embed = new EmbedBuilder()
		.setAuthor({name: member.user.tag, iconURL: member.user.displayAvatarURL()})
		.setTitle(succeeded ? "🍯 Honeypot triggered" : "🍯 Honeypot failed")
		.setDescription(succeeded
			? `${member} posted in <#${message.channelId}> and was **${row.action === "ban" ? "banned" : row.action === "kick" ? "kicked" : "timed out"}**.`
			: `${member} posted in <#${message.channelId}>, but the **${row.action}** failed: ${error}`)
		.addFields({name: "Member", value: `${member.user.tag} (\`${member.id}\`)`})
		.setColor(succeeded ? Colors.Orange : Colors.Red)
		.setTimestamp();
	await channel.send({embeds: [embed.toJSON()]}).catch(console.error);
}

/**
 * Counts how many distinct non-bot members have posted recently in a channel.
 *
 * Used to catch the one configuration mistake with the worst outcome: pointing a honeypot at a channel the
 * server actually uses, which would then ban everyone who talks in it.
 */
export async function countRecentPosters(channel: TextChannel): Promise<number> {
	try {
		const history = await channel.messages.fetch({limit: 50});
		return new Set(history.filter(message => !message.author.bot).map(message => message.author.id)).size;
	} catch {
		//An unreadable channel cannot be assessed; return 0 so the caller does not block on a failed check.
		return 0;
	}
}

export function pruneChannel(guild: Snowflake, channel: Snowflake): number {
	return database.prepare("DELETE FROM honeypot_channels WHERE guild = ? AND channel = ?").run(guild, channel).changes;
}
