// Prints a schema+rowcount fingerprint of a SQLite database, for before/after comparison when testing
// migrations. Read-only; safe to run against the live database while the bot is running.
//
// Usage: node scripts/dbstate.mjs <path-to-db>

import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const target = process.argv[2];
if (!target) {
	console.error("usage: node scripts/dbstate.mjs <path-to-db>");
	process.exit(1);
}

const db = new Database(target, {readonly: true});

console.log(`user_version = ${db.pragma("user_version", {simple: true})}`);

const objects = db.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
const tables = objects.filter(o => o.type === "table");
const indexes = objects.filter(o => o.type === "index");

console.log(`\ntables (${tables.length}):`);
for (const {name} of tables) {
	const {n} = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get();
	const columns = db.prepare(`SELECT name FROM pragma_table_info(?) ORDER BY cid`).all(name).map(c => c.name);
	console.log(`  ${name.padEnd(22)} rows=${String(n).padEnd(6)} cols=${columns.join(",")}`);
}

console.log(`\nindexes (${indexes.length}):`);
for (const {name} of indexes) console.log(`  ${name}`);

db.close();
