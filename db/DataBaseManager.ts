import Database from "better-sqlite3";
import {Snowflake} from "discord.js";

const db = new Database("./ranking.db");
db.pragma("journal_mode = WAL");

db.prepare("CREATE TABLE IF NOT EXISTS global_points (guild TEXT, member TEXT, points INTEGER, wins INTEGER, PRIMARY KEY (guild, member))").run();
db.prepare("CREATE TABLE IF NOT EXISTS daily_points (guild TEXT, member TEXT, day INTEGER, points INTEGER, wins INTEGER, PRIMARY KEY (guild, member, day))").run();

db.prepare("CREATE TABLE IF NOT EXISTS warnings (id INTEGER PRIMARY KEY AUTOINCREMENT, guild TEXT NOT NULL, member TEXT NOT NULL, moderator TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL)").run();
db.prepare("CREATE INDEX IF NOT EXISTS idx_warnings_guild_member ON warnings (guild, member)").run();

db.prepare("CREATE TABLE IF NOT EXISTS mod_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, guild TEXT NOT NULL, member TEXT NOT NULL, moderator TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, duration INTEGER, created_at INTEGER NOT NULL)").run();
db.prepare("CREATE INDEX IF NOT EXISTS idx_mod_actions_guild_member ON mod_actions (guild, member)").run();

db.prepare("CREATE TABLE IF NOT EXISTS reaction_roles (guild TEXT NOT NULL, message TEXT NOT NULL, emoji TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY (message, emoji))").run();
db.prepare("CREATE INDEX IF NOT EXISTS idx_reaction_roles_guild ON reaction_roles (guild)").run();

// Renamed from cults/cult_members/cult_wars before any real data was created against them.
db.prepare("DROP TABLE IF EXISTS cults").run();
db.prepare("DROP TABLE IF EXISTS cult_members").run();
db.prepare("DROP TABLE IF EXISTS cult_wars").run();

db.prepare("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, guild TEXT NOT NULL, name TEXT NOT NULL, icon TEXT NOT NULL, description TEXT NOT NULL, leader TEXT NOT NULL, member_role TEXT, officer_role TEXT, leader_role TEXT, created_at INTEGER NOT NULL)").run();
db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_guild_name ON orders (guild, name)").run();

db.prepare("CREATE TABLE IF NOT EXISTS order_members (guild TEXT NOT NULL, member TEXT NOT NULL, order_id INTEGER NOT NULL, officer INTEGER NOT NULL DEFAULT 0, joined_at INTEGER NOT NULL, PRIMARY KEY (guild, member))").run();
db.prepare("CREATE INDEX IF NOT EXISTS idx_order_members_order ON order_members (order_id)").run();

db.prepare("CREATE TABLE IF NOT EXISTS clashes (id INTEGER PRIMARY KEY AUTOINCREMENT, guild TEXT NOT NULL, order_a INTEGER NOT NULL, order_b INTEGER NOT NULL, race_type TEXT NOT NULL, started_by TEXT NOT NULL, start_time INTEGER NOT NULL, end_time INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, snapshot_a TEXT NOT NULL, snapshot_b TEXT NOT NULL, winner_order INTEGER, score_a REAL, score_b REAL, resolved_at INTEGER)").run();
db.prepare("CREATE INDEX IF NOT EXISTS idx_clashes_active_end ON clashes (active, end_time)").run();
db.prepare("CREATE INDEX IF NOT EXISTS idx_clashes_guild ON clashes (guild)").run();

db.prepare("CREATE TABLE IF NOT EXISTS economy_accounts (guild TEXT NOT NULL, member TEXT NOT NULL, balance INTEGER NOT NULL DEFAULT 0, last_daily INTEGER, last_work INTEGER, PRIMARY KEY (guild, member))").run();

db.prepare("CREATE TABLE IF NOT EXISTS economy_items (id INTEGER PRIMARY KEY AUTOINCREMENT, guild TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, price INTEGER NOT NULL, role_id TEXT, stock INTEGER, created_at INTEGER NOT NULL)").run();
db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_economy_items_guild_name ON economy_items (guild, name)").run();

db.prepare("CREATE TABLE IF NOT EXISTS economy_inventory (guild TEXT NOT NULL, member TEXT NOT NULL, item_id INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild, member, item_id))").run();
db.prepare("CREATE INDEX IF NOT EXISTS idx_economy_inventory_item ON economy_inventory (item_id)").run();

export function getProvider(): Database.Database {
	return db;
}

export function deleteGuild(id: Snowflake) {
	db.prepare("DELETE FROM global_points WHERE guild = ?").run(id);
	db.prepare("DELETE FROM daily_points WHERE guild = ?").run(id);
	db.prepare("DELETE FROM warnings WHERE guild = ?").run(id);
	db.prepare("DELETE FROM mod_actions WHERE guild = ?").run(id);
	db.prepare("DELETE FROM reaction_roles WHERE guild = ?").run(id);
	db.prepare("DELETE FROM orders WHERE guild = ?").run(id);
	db.prepare("DELETE FROM order_members WHERE guild = ?").run(id);
	db.prepare("DELETE FROM clashes WHERE guild = ?").run(id);
	db.prepare("DELETE FROM economy_accounts WHERE guild = ?").run(id);
	db.prepare("DELETE FROM economy_items WHERE guild = ?").run(id);
	db.prepare("DELETE FROM economy_inventory WHERE guild = ?").run(id);
}