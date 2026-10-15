import type {Migration} from "./index.js";

//Backing store for util/Scheduler.ts. Durable so that timed work (raid expiry, temp punishments, giveaway
//ends) still happens across a restart, which the old per-feature setInterval approach could not do.
const migration: Migration = {
	version: 2,
	name: "scheduled_tasks",
	up(db) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS scheduled_tasks (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				guild TEXT,
				type TEXT NOT NULL,
				payload TEXT NOT NULL,
				run_at INTEGER NOT NULL,
				attempts INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_run_at ON scheduled_tasks (run_at);
		`);
	}
};

export default migration;
