import type {Migration} from "./index.js";

//Backing store for util/PermissionUtil.ts. "Fake" permissions grant access to LIGHT's own commands without
//granting the equivalent native Discord permission, so a compromised moderator account cannot mass-ban
//through the Discord client or a raw API script - only through the bot, which rate-limits and logs.
const migration: Migration = {
	version: 3,
	name: "fake_permissions",
	up(db) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS fake_permissions (
				guild TEXT NOT NULL,
				role TEXT NOT NULL,
				permission TEXT NOT NULL,
				granted_by TEXT NOT NULL,
				granted_at INTEGER NOT NULL,
				PRIMARY KEY (guild, role, permission)
			);
			CREATE INDEX IF NOT EXISTS idx_fake_permissions_guild_role ON fake_permissions (guild, role);
		`);
	}
};

export default migration;
