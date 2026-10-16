//Dry-runs the pending migrations against a COPY of a database and reports what changed.
//
//The live database is the only copy of this bot's data, so no migration should reach it without being run
//against a snapshot first. This makes that a one-liner:
//
//    node scripts/trymigrate.mjs build/ranking.db
//
//It never writes to the database you point it at. It takes a VACUUM INTO snapshot (which, unlike a file
//copy, folds in the -wal that holds most of the contents), migrates the snapshot, and prints a diff.
import Database from "better-sqlite3";
import {mkdtempSync, rmSync} from "fs";
import {tmpdir} from "os";
import path from "path";
import {assertMigrationsWellFormed, migrations} from "../build/db/migrations/index.js";

const source = process.argv[2];
if (!source) {
	console.error("usage: node scripts/trymigrate.mjs <path-to-db>");
	process.exit(2);
}

const scratch = mkdtempSync(path.join(tmpdir(), "light-migrate-"));
const snapshot = path.join(scratch, "snapshot.db");

function describe(db) {
	const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
	const counts = {};
	for (const table of tables) counts[table] = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
	return {version: db.pragma("user_version", {simple: true}), tables, counts};
}

try {
	const live = new Database(source, {readonly: true});
	live.prepare("VACUUM INTO ?").run(snapshot);
	live.close();

	const db = new Database(snapshot);
	const before = describe(db);
	console.log(`before: user_version=${before.version}, ${before.tables.length} tables`);

	assertMigrationsWellFormed();
	const pending = migrations.filter(m => m.version > before.version);
	if (pending.length === 0) {
		console.log("nothing pending - the database is already at the latest version");
	} else {
		console.log(`pending: ${pending.map(m => `${m.version}_${m.name}`).join(", ")}`);
		for (const migration of pending) {
			db.transaction(() => {
				migration.up(db);
				db.exec(`PRAGMA user_version = ${migration.version}`);
			})();
		}
	}

	const after = describe(db);
	console.log(`after:  user_version=${after.version}, ${after.tables.length} tables`);

	const added = after.tables.filter(t => !before.tables.includes(t));
	const removed = before.tables.filter(t => !after.tables.includes(t));
	if (added.length) console.log(`  + new tables: ${added.join(", ")}`);
	//A migration should never drop a table, and a row count that moves means existing data was rewritten.
	if (removed.length) console.log(`  ! DROPPED TABLES: ${removed.join(", ")}`);

	let lost = false;
	for (const table of before.tables) {
		if (!after.tables.includes(table)) {
			lost = true;
			continue;
		}
		if (before.counts[table] !== after.counts[table]) {
			console.log(`  ! ROW COUNT CHANGED in ${table}: ${before.counts[table]} -> ${after.counts[table]}`);
			lost = true;
		}
	}

	db.close();
	console.log(lost || removed.length ? "\nFAILED: the migration altered existing data. Do not run this against the live database."
		: "\nOK: every pre-existing table and row count survived.");
	process.exitCode = lost || removed.length ? 1 : 0;
} finally {
	rmSync(scratch, {recursive: true, force: true});
}
