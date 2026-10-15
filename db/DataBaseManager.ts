import Database from "better-sqlite3";
import {Snowflake} from "discord.js";
import {assertMigrationsWellFormed, migrations} from "./migrations/index.js";

//Relative to cwd, and the bot is started with cwd=build (see start-bot.bat / `npm start`), so the live
//database is build/ranking.db. Most of its contents sit in ranking.db-wal, so never back it up by copying
//ranking.db alone - use VACUUM INTO (scripts/build.mjs does).
const db = new Database("./ranking.db");
db.pragma("journal_mode = WAL");

//Every table that stores rows keyed by guild, so deleteGuild() cannot silently miss one.
//Add new guild-scoped tables here in the same change that adds their migration.
const GUILD_SCOPED_TABLES = [
	"global_points",
	"daily_points",
	"warnings",
	"mod_actions",
	"reaction_roles",
	"orders",
	"order_members",
	"clashes",
	"economy_accounts",
	"economy_items",
	"economy_inventory",
	//Nullable guild - rows with a NULL guild are process-wide tasks and are correctly left alone by the
	//`WHERE guild = ?` delete below.
	"scheduled_tasks",
	"fake_permissions"
];

/**
 * Brings the database up to the latest schema version.
 *
 * Runs at module evaluation rather than from ClientReady on purpose: util modules such as EconomyUtil and
 * OrderUtil capture getProvider() at *import* time and query immediately, so any later hook would let them
 * touch tables that do not exist yet. It also has to finish before client.login(), because better-sqlite3 is
 * synchronous and a long migration would stall the gateway heartbeat.
 *
 * Version is tracked in SQLite's own user_version pragma - no bootstrap table, and it updates atomically with
 * the data in the same transaction.
 */
function runMigrations(): void {
	assertMigrationsWellFormed();

	const from = db.pragma("user_version", {simple: true}) as number;
	const pending = migrations.filter(migration => migration.version > from);
	if (pending.length === 0) return;

	for (const migration of pending) {
		if (!Number.isInteger(migration.version)) throw new Error(`Migration "${migration.name}" has a non-integer version`);
		//One transaction per migration, with the version bump last, so a failure leaves the database at the
		//last fully-applied version rather than half-way through.
		db.transaction(() => {
			migration.up(db);
			db.exec(`PRAGMA user_version = ${migration.version}`);
		})();
	}

	console.log(`Migrated database v${from} -> v${pending[pending.length - 1].version} (${pending.map(m => m.name).join(", ")})`);
}

runMigrations();

export function getProvider(): Database.Database {
	return db;
}

export function deleteGuild(id: Snowflake) {
	db.transaction(() => {
		for (const table of GUILD_SCOPED_TABLES) {
			db.prepare(`DELETE FROM ${table} WHERE guild = ?`).run(id);
		}
	})();
}
