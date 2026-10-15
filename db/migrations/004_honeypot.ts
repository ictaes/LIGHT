import type {Migration} from "./index.js";

//Honeypot channels: channels nobody legitimate should ever post in, usually named to bait the self-bots that
//walk a server posting scam links. Posting in one is treated as proof of automation.
//
//Stored per channel rather than per guild because a server will often want a chatty bait channel on a kick
//and a hidden one on a ban, and because the whole feature has to be switchable off per channel without
//losing the configuration.
const migration: Migration = {
	version: 4,
	name: "honeypot",
	up(db) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS honeypot_channels (
				guild TEXT NOT NULL,
				channel TEXT NOT NULL,
				action TEXT NOT NULL,
				--Milliseconds, and only meaningful when action = 'timeout'.
				timeout_duration INTEGER,
				--Passed straight to Discord's deleteMessageSeconds on a ban, so the offending message is removed
				--by the ban itself rather than by a second call that can fail on its own.
				delete_message_seconds INTEGER NOT NULL DEFAULT 0,
				enabled INTEGER NOT NULL DEFAULT 1,
				created_by TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				PRIMARY KEY (guild, channel)
			);

			CREATE TABLE IF NOT EXISTS honeypot_hits (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				guild TEXT NOT NULL,
				channel TEXT NOT NULL,
				member TEXT NOT NULL,
				content TEXT,
				action TEXT NOT NULL,
				--0 when the punishment failed. Recorded either way: a honeypot that silently fails to ban is
				--worse than one that is switched off, because it looks like it is working.
				succeeded INTEGER NOT NULL,
				error TEXT,
				created_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_honeypot_hits_guild ON honeypot_hits (guild, created_at);
		`);
	}
};

export default migration;
