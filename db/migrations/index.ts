import type Database from "better-sqlite3";
import initialSchema from "./001_initial_schema.js";
import scheduledTasks from "./002_scheduled_tasks.js";
import fakePermissions from "./003_fake_permissions.js";

export interface Migration {
	/** 1-based, contiguous, and never reused or renumbered once released - it is the on-disk schema version. */
	version: number;
	/** Short snake_case label, only used in log output. */
	name: string;
	/** Applied inside a transaction. Must not call getProvider() - use the db passed in, or you will deadlock. */
	up: (db: Database.Database) => void;
}

//Append new migrations here, in ascending version order. Never edit a released migration: add a new one.
//Guild-scoped tables must also be added to GUILD_SCOPED_TABLES in ../DataBaseManager.ts, or leaving a guild
//will orphan their rows.
export const migrations: Migration[] = [
	initialSchema,
	scheduledTasks,
	fakePermissions
];

//Guards against the two ways a hand-maintained list like this rots: a duplicated version (silently skipped)
//or a gap (the runner would stop early and never reach later migrations).
export function assertMigrationsWellFormed(): void {
	migrations.forEach((migration, index) => {
		const expected = index + 1;
		if (migration.version !== expected) {
			throw new Error(`Migration list is malformed: entry ${index} ("${migration.name}") has version ${migration.version}, expected ${expected}. Versions must start at 1, be contiguous, and be sorted ascending.`);
		}
	});
}
