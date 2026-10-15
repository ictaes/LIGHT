// Safe build wrapper.
//
// `tsc` used to re-emit the repo-root config.json/settings.json over the live copies in build/,
// silently wiping the bot token and every guild's settings. The imports are now runtime reads so
// tsc no longer touches them, but this wrapper keeps a backup/restore pass as a safety net and
// snapshots the database before every build.
//
// Usage: npm run build

import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const build = path.join(root, "build");
const backups = path.join(build, "backups");

// Files that live only in build/ and must never be lost to a compile.
const protectedFiles = ["config.json", "settings.json"];
const keepBackups = 10;

function timestamp() {
	const d = new Date();
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function backup() {
	const dir = path.join(backups, timestamp());
	fs.mkdirSync(dir, {recursive: true});

	const saved = [];
	for (const file of protectedFiles) {
		const src = path.join(build, file);
		if (!fs.existsSync(src)) continue;
		fs.copyFileSync(src, path.join(dir, file));
		saved.push(file);
	}

	// VACUUM INTO gives a consistent snapshot even while the bot is running and holding a WAL.
	// A plain file copy of ranking.db would miss everything still in ranking.db-wal.
	const db = path.join(build, "ranking.db");
	if (fs.existsSync(db)) {
		try {
			const require = createRequire(import.meta.url);
			const Database = require("better-sqlite3");
			const handle = new Database(db, {readonly: true});
			handle.prepare("VACUUM INTO ?").run(path.join(dir, "ranking.db"));
			handle.close();
			saved.push("ranking.db");
		} catch (e) {
			console.warn(`! database snapshot failed: ${e.message}`);
		}
	}

	console.log(`> backed up ${saved.join(", ") || "nothing"} to build/backups/${path.basename(dir)}`);
	return dir;
}

function restore(dir) {
	const restored = [];
	for (const file of protectedFiles) {
		const src = path.join(dir, file);
		if (!fs.existsSync(src)) continue;
		const dest = path.join(build, file);
		// Only restore if tsc actually changed it, so a normal build stays quiet.
		if (fs.existsSync(dest) && fs.readFileSync(dest).equals(fs.readFileSync(src))) continue;
		fs.copyFileSync(src, dest);
		restored.push(file);
	}
	if (restored.length) console.log(`> restored ${restored.join(", ")} (tsc had overwritten them)`);
	return restored;
}

function prune() {
	if (!fs.existsSync(backups)) return;
	const dirs = fs.readdirSync(backups).sort();
	for (const dir of dirs.slice(0, Math.max(0, dirs.length - keepBackups))) {
		fs.rmSync(path.join(backups, dir), {recursive: true, force: true});
	}
}

const dir = backup();
// Single command string with shell:true - passing an args array alongside shell:true is deprecated.
const result = spawnSync(["npx", "tsc", ...process.argv.slice(2)].join(" "), {cwd: root, stdio: "inherit", shell: true});
// Restore even on failure — tsc may have emitted over the config before hitting an error.
const clobbered = restore(dir);
prune();

if (result.status !== 0) {
	console.error(`\n! build failed (tsc exit ${result.status})`);
	process.exit(result.status ?? 1);
}
if (clobbered.length) {
	console.error(`\n! tsc overwrote ${clobbered.join(", ")} — restored from backup, but something has regressed.`);
	console.error(`  Some source file is importing JSON (\`import x from "./foo.json"\`), which pulls it into the`);
	console.error(`  compile and emits it over build/. Find it and switch it to a runtime fs read.`);
}
console.log("> build ok");
