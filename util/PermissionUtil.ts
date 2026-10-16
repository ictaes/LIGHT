import {GuildMember, PermissionFlagsBits, Snowflake} from "discord.js";
import * as db from "../db/DataBaseManager.js";
import {config} from "../Config.js";
import {getServerContext} from "../BotSettingProvider.js";

const database = db.getProvider();

/**
 * LIGHT's own permission vocabulary. These gate access to *bot commands* only - they never grant anything in
 * Discord itself.
 */
export type LightPermission =
	| "manage_points"
	| "manage_economy"
	| "moderate_members"
	| "manage_messages"
	| "manage_roles"
	| "manage_logging"
	| "manage_antinuke"
	| "administrator";

export const ALL_PERMISSIONS: LightPermission[] = [
	"manage_points", "manage_economy", "moderate_members", "manage_messages",
	"manage_roles", "manage_logging", "manage_antinuke", "administrator"
];

/**
 * The native Discord permission that implies each LIGHT permission. Holding the real thing always grants the
 * LIGHT equivalent, so an admin never locks themselves out of their own bot.
 */
const DISCORD_EQUIVALENT: Record<LightPermission, bigint> = {
	manage_points: PermissionFlagsBits.ManageGuild,
	manage_economy: PermissionFlagsBits.ManageGuild,
	moderate_members: PermissionFlagsBits.ModerateMembers,
	manage_messages: PermissionFlagsBits.ManageMessages,
	manage_roles: PermissionFlagsBits.ManageRoles,
	manage_logging: PermissionFlagsBits.ManageGuild,
	manage_antinuke: PermissionFlagsBits.Administrator,
	administrator: PermissionFlagsBits.Administrator
};

/**
 * What a legacy `mod_roles` entry grants. Intentionally narrow: before this module existed, mod_roles was a
 * single flat "is a mod" flag checked by hasModAccess(), so it must keep granting exactly what that gated -
 * and nothing more. In particular it must NOT grant manage_antinuke, or every existing mod silently gains
 * control of the anti-nuke system the moment that ships.
 */
const LEGACY_MOD_ROLE_PERMISSIONS: LightPermission[] = [
	"manage_points", "manage_economy", "moderate_members", "manage_messages"
];

/**
 * Permissions that may be handed out as fake permissions.
 *
 * `administrator` and `manage_antinuke` are excluded on purpose: granting either through this system would
 * let a holder either escalate arbitrarily or disable the protection that constrains them. Keeping them out
 * of the list means the grant command cannot even express it.
 */
export const GRANTABLE_PERMISSIONS: LightPermission[] = ALL_PERMISSIONS.filter(
	permission => permission !== "administrator" && permission !== "manage_antinuke"
);

export interface FakePermissionRow {
	guild: Snowflake;
	role: Snowflake;
	permission: string;
	granted_by: Snowflake;
	granted_at: number;
}

export type PermissionSource = "owner" | "bot_owner" | "discord_permission" | "mod_role" | "fake_permission" | "none";

export interface PermissionResult {
	allowed: boolean;
	source: PermissionSource;
}

/**
 * Resolves whether a member holds a LIGHT permission, and says why.
 *
 * Order matters and is a safety property: the guild owner and real Discord permission holders are checked
 * before any bot-specific configuration, so a misconfigured fake-permission table can never lock the people
 * who own the server out of fixing it.
 */
export function resolvePermission(member: GuildMember, permission: LightPermission): PermissionResult {
	if (member.id === member.guild.ownerId) return {allowed: true, source: "owner"};
	if (member.id === config.bot_owner) return {allowed: true, source: "bot_owner"};

	//Administrator implies everything, which is how Discord itself behaves.
	if (member.permissions.has(PermissionFlagsBits.Administrator)) return {allowed: true, source: "discord_permission"};
	if (member.permissions.has(DISCORD_EQUIVALENT[permission])) return {allowed: true, source: "discord_permission"};

	if (LEGACY_MOD_ROLE_PERMISSIONS.includes(permission)) {
		const settings = getServerContext(member.guild.id);
		if (settings && member.roles.cache.some(role => settings.mod_roles.includes(role.id))) {
			return {allowed: true, source: "mod_role"};
		}
	}

	if (hasFakePermission(member, permission)) return {allowed: true, source: "fake_permission"};

	return {allowed: false, source: "none"};
}

export function hasPermission(member: GuildMember, permission: LightPermission): boolean {
	return resolvePermission(member, permission).allowed;
}

/**
 * Narrow variant of hasModAccess's old contract: owner, bot owner and Administrator always pass (so nobody
 * can lock themselves out of their own server/bot), and otherwise access is granted ONLY via a configured
 * mod_role.
 *
 * Deliberately does NOT fall through to the native Discord permission that would otherwise back `permission`
 * (e.g. ModerateMembers). That fallback lives in resolvePermission()/hasPermission() for the granular
 * manage_economy/manage_roles/manage_messages permission system and fake permissions, but mod-gated commands
 * must stay scoped to mod_roles - a guild that hands a broad "Staff" role Discord's native Timeout Members
 * permission without ever adding that role to LIGHT's own mod_roles setting should not silently get
 * economy-admin/order-admin rights through it.
 */
export function hasModRoleAccess(member: GuildMember): boolean {
	if (member.id === member.guild.ownerId) return true;
	if (member.id === config.bot_owner) return true;
	if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

	const settings = getServerContext(member.guild.id);
	return !!settings && member.roles.cache.some(role => settings.mod_roles.includes(role.id));
}

function hasFakePermission(member: GuildMember, permission: LightPermission): boolean {
	const roleIds = [...member.roles.cache.keys()];
	if (roleIds.length === 0) return false;
	const placeholders = roleIds.map(() => "?").join(", ");
	const row = database.prepare<(string | Snowflake)[], { count: number }>(
		`SELECT COUNT(*) AS count FROM fake_permissions WHERE guild = ? AND permission = ? AND role IN (${placeholders})`
	).get(member.guild.id, permission, ...roleIds);
	return (row?.count ?? 0) > 0;
}

export function getFakePermissions(guild: Snowflake, role: Snowflake): LightPermission[] {
	return database.prepare<[Snowflake, Snowflake], { permission: string }>("SELECT permission FROM fake_permissions WHERE guild = ? AND role = ? ORDER BY permission")
		.all(guild, role)
		.map(row => row.permission as LightPermission);
}

export function getAllFakePermissions(guild: Snowflake): FakePermissionRow[] {
	return database.prepare<[Snowflake], FakePermissionRow>("SELECT * FROM fake_permissions WHERE guild = ? ORDER BY role, permission").all(guild);
}

/** Returns false if the role already had the permission. */
export function grantFakePermission(guild: Snowflake, role: Snowflake, permission: LightPermission, grantedBy: Snowflake): boolean {
	if (!GRANTABLE_PERMISSIONS.includes(permission)) throw new Error(`"${permission}" cannot be granted as a fake permission`);
	return database.prepare("INSERT OR IGNORE INTO fake_permissions (guild, role, permission, granted_by, granted_at) VALUES (?, ?, ?, ?, ?)")
		.run(guild, role, permission, grantedBy, Date.now()).changes > 0;
}

export function revokeFakePermission(guild: Snowflake, role: Snowflake, permission: LightPermission): boolean {
	return database.prepare("DELETE FROM fake_permissions WHERE guild = ? AND role = ? AND permission = ?").run(guild, role, permission).changes > 0;
}

export function revokeAllFakePermissions(guild: Snowflake, role: Snowflake): number {
	return database.prepare("DELETE FROM fake_permissions WHERE guild = ? AND role = ?").run(guild, role).changes;
}

/** Called on GuildRoleDelete so deleted roles do not leave rows that silently match a recycled role id. */
export function pruneRole(guild: Snowflake, role: Snowflake): number {
	return database.prepare("DELETE FROM fake_permissions WHERE guild = ? AND role = ?").run(guild, role).changes;
}
