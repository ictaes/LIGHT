import assert from "node:assert/strict";
import {beforeEach, describe, it} from "node:test";
import Database from "better-sqlite3";
import {migrations} from "../build/db/migrations/index.js";

//HoneypotUtil itself cannot be imported here - it reaches PointManager through PermissionUtil and would log
//the bot in. These cover the schema contracts the util depends on. See tests/README.md.
function freshDatabase() {
	const db = new Database(":memory:");
	for (const migration of migrations) migration.up(db);
	return db;
}

describe("honeypot_channels", () => {
	let db;
	beforeEach(() => { db = freshDatabase(); });

	const add = (db, channel, action) => db.prepare("INSERT INTO honeypot_channels (guild, channel, action, timeout_duration, delete_message_seconds, enabled, created_by, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
		.run("g1", channel, action, null, 3600, "admin", Date.now());

	it("is armed by default, so adding one is never a silent no-op", () => {
		add(db, "c1", "ban");
		assert.equal(db.prepare("SELECT enabled FROM honeypot_channels WHERE channel = ?").get("c1").enabled, 1);
	});

	it("is keyed per channel, so one guild can run several with different actions", () => {
		add(db, "c1", "ban");
		add(db, "c2", "kick");
		const rows = db.prepare("SELECT channel, action FROM honeypot_channels WHERE guild = ? ORDER BY channel").all("g1");
		assert.deepEqual(rows, [{channel: "c1", action: "ban"}, {channel: "c2", action: "kick"}]);
	});

	it("re-adding a channel updates it rather than creating a second conflicting row", () => {
		//Two rows for one channel would make which punishment applies depend on row order.
		add(db, "c1", "kick");
		db.prepare("INSERT INTO honeypot_channels (guild, channel, action, timeout_duration, delete_message_seconds, enabled, created_by, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT (guild, channel) DO UPDATE SET action = excluded.action")
			.run("g1", "c1", "ban", null, 3600, "admin", Date.now());
		const rows = db.prepare("SELECT action FROM honeypot_channels WHERE guild = ? AND channel = ?").all("g1", "c1");
		assert.equal(rows.length, 1);
		assert.equal(rows[0].action, "ban");
	});
});

describe("honeypot_hits", () => {
	it("records a failed punishment, not just a successful one", () => {
		//A honeypot that silently fails to ban is worse than one that is switched off, because it still
		//looks like it is working. The failure has to be visible in /honeypot history.
		const db = freshDatabase();
		db.prepare("INSERT INTO honeypot_hits (guild, channel, member, content, action, succeeded, error, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)")
			.run("g1", "c1", "m1", "spam", "ban", "the target's highest role is at or above the bot's", Date.now());
		const row = db.prepare("SELECT succeeded, error FROM honeypot_hits WHERE guild = ?").get("g1");
		assert.equal(row.succeeded, 0);
		assert.match(row.error, /above the bot/);
	});

	it("allows null content, because bait is often an image with no text", () => {
		const db = freshDatabase();
		assert.doesNotThrow(() => db.prepare("INSERT INTO honeypot_hits (guild, channel, member, content, action, succeeded, error, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
			.run("g1", "c1", "m1", null, "kick", null, Date.now()));
	});
});
