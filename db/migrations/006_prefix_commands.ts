import type {Migration} from "./index.js";

//Prefix commands ship off by default, like every other new subsystem: a guild with no row here sees no
//change in behaviour from before this migration existed. Mention-invocation (`@LIGHT ban ...`) does not need
//a row at all - it is handled in util/PrefixDispatcher.ts independently of this table.
//
//Aliases map to a top-level command name only, not a specific subcommand+args template - see the design
//notes in util/PrefixDispatcher.ts for why.
const migration: Migration = {
	version: 6,
	name: "prefix_commands",
	up(db) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS prefix_config (
				guild TEXT PRIMARY KEY,
				prefix TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1
			);
			CREATE TABLE IF NOT EXISTS command_aliases (
				guild TEXT NOT NULL,
				alias TEXT NOT NULL,
				command TEXT NOT NULL,
				PRIMARY KEY (guild, alias)
			);
		`);
	}
};

export default migration;
