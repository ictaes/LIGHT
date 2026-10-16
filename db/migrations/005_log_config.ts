import type {Migration} from "./index.js";

//Per-category log routing. Before this there were exactly two destinations, both in settings.json:
//log_channel_id for point-economy actions and mod_log_channel_id for everything else, which meant member
//joins, message edits, automod hits and clash results all landed in one channel together.
//
//A category with no row here falls back to the legacy setting, so every existing call site keeps working
//without being touched and a server that never configures this sees no change.
const migration: Migration = {
	version: 5,
	name: "log_config",
	up(db) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS log_config (
				guild TEXT NOT NULL,
				category TEXT NOT NULL,
				channel TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1,
				--JSON arrays rather than join tables, deliberately: these are read once per log emission and
				--never filtered on, so there is nothing for an index to do.
				ignored_channels TEXT NOT NULL DEFAULT '[]',
				ignored_roles TEXT NOT NULL DEFAULT '[]',
				updated_by TEXT NOT NULL,
				updated_at INTEGER NOT NULL,
				PRIMARY KEY (guild, category)
			);
		`);
	}
};

export default migration;
