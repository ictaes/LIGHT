import assert from "node:assert/strict";
import {before, describe, it} from "node:test";
import Database from "better-sqlite3";
import {assertMigrationsWellFormed, GUILD_SCOPED_TABLES, migrations} from "../build/db/migrations/index.js";

//Mirrors runMigrations() in DataBaseManager, which cannot be imported here because it opens the live
//database file at module evaluation.
function migrate(db, upTo = Infinity) {
	for (const migration of migrations.filter(m => m.version <= upTo)) {
		db.transaction(() => {
			migration.up(db);
			db.exec(`PRAGMA user_version = ${migration.version}`);
		})();
	}
	return db;
}

function freshDatabase(upTo) {
	return migrate(new Database(":memory:"), upTo);
}

function tableNames(db) {
	return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
		.all().map(row => row.name);
}

function columnNames(db, table) {
	return db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
}

describe("migration list", () => {
	it("is well formed", () => {
		assert.doesNotThrow(assertMigrationsWellFormed);
	});

	it("has versions starting at 1, contiguous and ascending", () => {
		assert.deepEqual(migrations.map(m => m.version), migrations.map((_, i) => i + 1));
	});

	it("has a unique name per migration", () => {
		const names = migrations.map(m => m.name);
		assert.equal(new Set(names).size, names.length);
	});
});

describe("applying migrations", () => {
	it("brings a fresh database to the latest version", () => {
		const db = freshDatabase();
		assert.equal(db.pragma("user_version", {simple: true}), migrations.length);
	});

	it("is idempotent - re-running every migration changes nothing", () => {
		const db = freshDatabase();
		const before = tableNames(db);
		assert.doesNotThrow(() => migrate(db));
		assert.deepEqual(tableNames(db), before);
	});

	it("preserves rows written before a later migration runs", () => {
		//The real hazard this guards: a migration that recreates rather than alters a table would silently
		//drop live data, and the live database is the only copy.
		const db = freshDatabase(1);
		db.prepare("INSERT INTO global_points (guild, member, points, wins) VALUES (?, ?, ?, ?)").run("g1", "m1", 42, 7);
		migrate(db);
		const row = db.prepare("SELECT points, wins FROM global_points WHERE guild = ? AND member = ?").get("g1", "m1");
		assert.deepEqual(row, {points: 42, wins: 7});
	});

	it("creates every table the deleteGuild list names", () => {
		const tables = tableNames(freshDatabase());
		for (const table of GUILD_SCOPED_TABLES) {
			assert.ok(tables.includes(table), `GUILD_SCOPED_TABLES names "${table}", which no migration creates`);
		}
	});
});

describe("GUILD_SCOPED_TABLES", () => {
	let db;
	before(() => { db = freshDatabase(); });

	it("lists every table that has a guild column", () => {
		//deleteGuild() only deletes from tables on this list, so a guild-scoped table missing from it leaves
		//that guild's rows behind forever after the bot is removed from the server.
		const withGuildColumn = tableNames(db).filter(table => columnNames(db, table).includes("guild"));
		assert.deepEqual(withGuildColumn.sort(), [...GUILD_SCOPED_TABLES].sort());
	});

	it("contains no duplicates", () => {
		assert.equal(new Set(GUILD_SCOPED_TABLES).size, GUILD_SCOPED_TABLES.length);
	});
});

describe("scheduled_tasks", () => {
	it("has the index the scheduler's polling query needs", () => {
		const db = freshDatabase();
		const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'scheduled_tasks'")
			.all().map(row => row.name);
		assert.ok(indexes.includes("idx_scheduled_tasks_run_at"), "a full scan every tick would be the whole cost of the scheduler");
	});

	it("allows a null guild for process-wide tasks", () => {
		const db = freshDatabase();
		assert.doesNotThrow(() => db.prepare("INSERT INTO scheduled_tasks (guild, type, payload, run_at, created_at) VALUES (?, ?, ?, ?, ?)")
			.run(null, "unban", "{}", Date.now(), Date.now()));
	});
});

describe("fake_permissions", () => {
	it("is keyed on (guild, role, permission) so a repeated grant is a no-op", () => {
		const db = freshDatabase();
		const insert = db.prepare("INSERT OR IGNORE INTO fake_permissions (guild, role, permission, granted_by, granted_at) VALUES (?, ?, ?, ?, ?)");
		assert.equal(insert.run("g1", "r1", "manage_points", "u1", 1).changes, 1);
		assert.equal(insert.run("g1", "r1", "manage_points", "u2", 2).changes, 0, "a duplicate grant must not create a second row");
		assert.equal(db.prepare("SELECT COUNT(*) AS c FROM fake_permissions").get().c, 1);
	});
});
