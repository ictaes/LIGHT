import {Snowflake} from "discord.js";
import * as db from "../db/DataBaseManager.js";

const database = db.getProvider();

export interface EconomyAccountRow {
	guild: Snowflake,
	member: Snowflake,
	balance: number,
	last_daily: number | null,
	last_work: number | null
}

export interface EconomyItemRow {
	id: number,
	guild: Snowflake,
	name: string,
	description: string,
	price: number,
	role_id: Snowflake | null,
	stock: number | null,
	created_at: number
}

export interface InventoryRow {
	guild: Snowflake,
	member: Snowflake,
	item_id: number,
	quantity: number
}

export type BuyResult = "ok" | "insufficient_funds" | "out_of_stock" | "already_owned" | "not_found";

// ----- Accounts -----

function ensureAccount(guild: Snowflake, member: Snowflake, startingBalance: number) {
	database.prepare("INSERT INTO economy_accounts (guild, member, balance) VALUES (?, ?, ?) ON CONFLICT (guild, member) DO NOTHING").run(guild, member, startingBalance);
}

export function getBalance(guild: Snowflake, member: Snowflake, startingBalance: number = 0): number {
	const row = database.prepare<[Snowflake, Snowflake], { balance: number }>("SELECT balance FROM economy_accounts WHERE guild = ? AND member = ?").get(guild, member);
	return row ? row.balance : startingBalance;
}

export function addBalance(guild: Snowflake, member: Snowflake, delta: number, startingBalance: number = 0): number {
	ensureAccount(guild, member, startingBalance);
	const row = database.prepare<[number, Snowflake, Snowflake], { balance: number }>("UPDATE economy_accounts SET balance = MAX(0, balance + ?) WHERE guild = ? AND member = ? RETURNING balance").get(delta, guild, member);
	return row ? row.balance : 0;
}

export function setBalance(guild: Snowflake, member: Snowflake, balance: number, startingBalance: number = 0): number {
	ensureAccount(guild, member, startingBalance);
	const clamped = Math.max(0, Math.round(balance));
	database.prepare("UPDATE economy_accounts SET balance = ? WHERE guild = ? AND member = ?").run(clamped, guild, member);
	return clamped;
}

export function transfer(guild: Snowflake, from: Snowflake, to: Snowflake, amount: number, startingBalance: number = 0): boolean {
	if (amount <= 0) return false;
	const run = database.transaction((): boolean => {
		if (getBalance(guild, from, startingBalance) < amount) return false;
		addBalance(guild, from, -amount, startingBalance);
		addBalance(guild, to, amount, startingBalance);
		return true;
	});
	return run();
}

// Atomically checks-and-deducts a bet amount in one transaction, so a double-fired interaction
// can't have two concurrent executions both read the same stale balance and both pass the
// sufficient-funds check. Returns false (no mutation) if funds are insufficient at the moment
// of the atomic update; returns true if the deduction succeeded.
export function placeBet(guild: Snowflake, member: Snowflake, amount: number, startingBalance: number = 0): boolean {
	if (amount <= 0) return false;
	const run = database.transaction((): boolean => {
		ensureAccount(guild, member, startingBalance);
		const result = database.prepare("UPDATE economy_accounts SET balance = balance - ? WHERE guild = ? AND member = ? AND balance >= ?")
			.run(amount, guild, member, amount);
		return result.changes === 1;
	});
	return run();
}

// ----- Cooldown claims (daily/work) -----

function claimCooldown(guild: Snowflake, member: Snowflake, amount: number, cooldownMs: number, startingBalance: number, column: "last_daily" | "last_work"): boolean {
	const run = database.transaction((): boolean => {
		ensureAccount(guild, member, startingBalance);
		const now = Date.now();
		const result = database.prepare(`UPDATE economy_accounts SET balance = MAX(0, balance + ?), ${column} = ? WHERE guild = ? AND member = ? AND (${column} IS NULL OR ? - ${column} >= ?)`)
			.run(amount, now, guild, member, now, cooldownMs);
		return result.changes === 1;
	});
	return run();
}

export function claimDaily(guild: Snowflake, member: Snowflake, amount: number, cooldownMs: number, startingBalance: number = 0): boolean {
	return claimCooldown(guild, member, amount, cooldownMs, startingBalance, "last_daily");
}

export function claimWork(guild: Snowflake, member: Snowflake, amount: number, cooldownMs: number, startingBalance: number = 0): boolean {
	return claimCooldown(guild, member, amount, cooldownMs, startingBalance, "last_work");
}

export function getCooldowns(guild: Snowflake, member: Snowflake): { last_daily: number | null, last_work: number | null } {
	const row = database.prepare<[Snowflake, Snowflake], { last_daily: number | null, last_work: number | null }>("SELECT last_daily, last_work FROM economy_accounts WHERE guild = ? AND member = ?").get(guild, member);
	return row || {last_daily: null, last_work: null};
}

// ----- Shop CRUD -----

export function createItem(guild: Snowflake, name: string, description: string, price: number, roleId: Snowflake | null, stock: number | null): EconomyItemRow {
	const result = database.prepare("INSERT INTO economy_items (guild, name, description, price, role_id, stock, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
		.run(guild, name, description, price, roleId, stock, Date.now());
	return getItemById(result.lastInsertRowid as number) as EconomyItemRow;
}

export function deleteItem(itemId: number) {
	database.prepare("DELETE FROM economy_inventory WHERE item_id = ?").run(itemId);
	database.prepare("DELETE FROM economy_items WHERE id = ?").run(itemId);
}

export function getItemById(id: number): EconomyItemRow | null {
	return database.prepare<[number], EconomyItemRow>("SELECT * FROM economy_items WHERE id = ?").get(id) || null;
}

export function getItemByName(guild: Snowflake, name: string): EconomyItemRow | null {
	return database.prepare<[Snowflake, string], EconomyItemRow>("SELECT * FROM economy_items WHERE guild = ? AND name = ? COLLATE NOCASE").get(guild, name) || null;
}

export function getItemsForGuild(guild: Snowflake): EconomyItemRow[] {
	return database.prepare<[Snowflake], EconomyItemRow>("SELECT * FROM economy_items WHERE guild = ? ORDER BY name COLLATE NOCASE").all(guild);
}

export function updateItem(itemId: number, fields: Partial<Pick<EconomyItemRow, "description" | "price" | "role_id" | "stock">>) {
	const current = getItemById(itemId);
	if (!current) return;
	// Only overwrite fields explicitly present and non-undefined - a plain {...current, ...fields} spread
	// would stomp untouched NOT NULL columns to undefined (bound as NULL by better-sqlite3) whenever a
	// caller omits them, since object spread copies keys with an explicit `undefined` value too.
	const updated = {
		description: fields.description !== undefined ? fields.description : current.description,
		price: fields.price !== undefined ? fields.price : current.price,
		role_id: fields.role_id !== undefined ? fields.role_id : current.role_id,
		stock: fields.stock !== undefined ? fields.stock : current.stock
	};
	database.prepare("UPDATE economy_items SET description = ?, price = ?, role_id = ?, stock = ? WHERE id = ?")
		.run(updated.description, updated.price, updated.role_id, updated.stock, itemId);
}

// ----- Purchases & inventory -----

export function getInventory(guild: Snowflake, member: Snowflake): (InventoryRow & { item: EconomyItemRow })[] {
	const rows = database.prepare<[Snowflake, Snowflake], InventoryRow>("SELECT * FROM economy_inventory WHERE guild = ? AND member = ? AND quantity > 0").all(guild, member);
	return rows.map(row => ({...row, item: getItemById(row.item_id) as EconomyItemRow})).filter(row => row.item);
}

export function buyItem(guild: Snowflake, member: Snowflake, itemId: number, startingBalance: number = 0): BuyResult {
	const run = database.transaction((): BuyResult => {
		const item = getItemById(itemId);
		if (!item || item.guild !== guild) return "not_found";
		if (item.role_id) {
			const owned = database.prepare<[Snowflake, Snowflake, number], { quantity: number }>("SELECT quantity FROM economy_inventory WHERE guild = ? AND member = ? AND item_id = ?").get(guild, member, itemId);
			if (owned && owned.quantity > 0) return "already_owned";
		}
		if (getBalance(guild, member, startingBalance) < item.price) return "insufficient_funds";
		if (item.stock !== null) {
			const result = database.prepare("UPDATE economy_items SET stock = stock - 1 WHERE id = ? AND stock > 0").run(itemId);
			if (result.changes !== 1) return "out_of_stock";
		}
		addBalance(guild, member, -item.price, startingBalance);
		database.prepare("INSERT INTO economy_inventory (guild, member, item_id, quantity) VALUES (?, ?, ?, 1) ON CONFLICT (guild, member, item_id) DO UPDATE SET quantity = quantity + 1").run(guild, member, itemId);
		return "ok";
	});
	return run();
}

// ----- Leaderboard -----

export function getEconomyLeaderboard(guild: Snowflake): { member: Snowflake, value: number }[] {
	return database.prepare<[Snowflake], { member: Snowflake, value: number }>("SELECT member, balance AS value FROM economy_accounts WHERE guild = ? ORDER BY balance DESC LIMIT 10").all(guild);
}
