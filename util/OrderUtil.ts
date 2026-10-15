import {Snowflake} from "discord.js";
import * as db from "../db/DataBaseManager.js";

const database = db.getProvider();

export interface OrderRow {
	id: number,
	guild: Snowflake,
	name: string,
	icon: string,
	description: string,
	leader: Snowflake,
	member_role: Snowflake | null,
	officer_role: Snowflake | null,
	leader_role: Snowflake | null,
	created_at: number
}

export interface OrderMemberRow {
	guild: Snowflake,
	member: Snowflake,
	order_id: number,
	officer: number,
	joined_at: number
}

export interface ClashSnapshot {
	members: Snowflake[],
	perMember: { [member: string]: { points: number, wins: number } }
}

export type RaceType = "points" | "wins" | "both";

export interface ClashRow {
	id: number,
	guild: Snowflake,
	order_a: number,
	order_b: number,
	race_type: RaceType,
	started_by: Snowflake,
	start_time: number,
	end_time: number,
	active: number,
	snapshot_a: string,
	snapshot_b: string,
	winner_order: number | null,
	score_a: number | null,
	score_b: number | null,
	resolved_at: number | null
}

export interface ClashResult {
	clash: ClashRow,
	scoreA: number,
	scoreB: number,
	winnerOrder: number // 0 = draw, otherwise an order id
}

// ----- Order CRUD -----

export function createOrder(guild: Snowflake, name: string, icon: string, description: string, leader: Snowflake): OrderRow {
	const result = database.prepare("INSERT INTO orders (guild, name, icon, description, leader, member_role, officer_role, leader_role, created_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?)").run(guild, name, icon, description, leader, Date.now());
	const order = getOrderById(result.lastInsertRowid as number) as OrderRow;
	addOrderMember(guild, leader, order.id);
	return order;
}

export function deleteOrder(orderId: number) {
	database.prepare("DELETE FROM order_members WHERE order_id = ?").run(orderId);
	database.prepare("DELETE FROM orders WHERE id = ?").run(orderId);
}

export function getOrderById(id: number): OrderRow | null {
	return database.prepare<[number], OrderRow>("SELECT * FROM orders WHERE id = ?").get(id) || null;
}

export function getOrderByName(guild: Snowflake, name: string): OrderRow | null {
	return database.prepare<[Snowflake, string], OrderRow>("SELECT * FROM orders WHERE guild = ? AND name = ? COLLATE NOCASE").get(guild, name) || null;
}

export function getOrdersForGuild(guild: Snowflake): OrderRow[] {
	return database.prepare<[Snowflake], OrderRow>("SELECT * FROM orders WHERE guild = ? ORDER BY name COLLATE NOCASE").all(guild);
}

export function getOrderForMember(guild: Snowflake, member: Snowflake): (OrderRow & { officer: boolean }) | null {
	const membership = database.prepare<[Snowflake, Snowflake], OrderMemberRow>("SELECT * FROM order_members WHERE guild = ? AND member = ?").get(guild, member);
	if (!membership) return null;
	const order = getOrderById(membership.order_id);
	if (!order) return null;
	return {...order, officer: membership.officer === 1};
}

export function addOrderMember(guild: Snowflake, member: Snowflake, orderId: number, officer: boolean = false) {
	database.prepare("INSERT INTO order_members (guild, member, order_id, officer, joined_at) VALUES (?, ?, ?, ?, ?)").run(guild, member, orderId, officer ? 1 : 0, Date.now());
}

export function removeOrderMember(guild: Snowflake, member: Snowflake) {
	database.prepare("DELETE FROM order_members WHERE guild = ? AND member = ?").run(guild, member);
}

export function setOrderOfficer(guild: Snowflake, member: Snowflake, officer: boolean) {
	database.prepare("UPDATE order_members SET officer = ? WHERE guild = ? AND member = ?").run(officer ? 1 : 0, guild, member);
}

export function getOrderMembers(orderId: number): OrderMemberRow[] {
	return database.prepare<[number], OrderMemberRow>("SELECT * FROM order_members WHERE order_id = ?").all(orderId);
}

export function updateOrder(orderId: number, fields: Partial<Pick<OrderRow, "name" | "icon" | "description" | "member_role" | "officer_role" | "leader_role" | "leader">>) {
	const current = getOrderById(orderId);
	if (!current) return;
	const updated = {
		name: fields.name !== undefined ? fields.name : current.name,
		icon: fields.icon !== undefined ? fields.icon : current.icon,
		description: fields.description !== undefined ? fields.description : current.description,
		member_role: fields.member_role !== undefined ? fields.member_role : current.member_role,
		officer_role: fields.officer_role !== undefined ? fields.officer_role : current.officer_role,
		leader_role: fields.leader_role !== undefined ? fields.leader_role : current.leader_role,
		leader: fields.leader !== undefined ? fields.leader : current.leader
	};
	database.prepare("UPDATE orders SET name = ?, icon = ?, description = ?, member_role = ?, officer_role = ?, leader_role = ?, leader = ? WHERE id = ?")
		.run(updated.name, updated.icon, updated.description, updated.member_role, updated.officer_role, updated.leader_role, updated.leader, orderId);
}

// ----- Permissions -----

export function hasOrderAccess(guild: Snowflake, member: Snowflake, orderId: number): boolean {
	const order = getOrderForMember(guild, member);
	if (!order || order.id !== orderId) return false;
	return order.leader === member || order.officer;
}

export function isOrderLeader(guild: Snowflake, member: Snowflake, orderId: number): boolean {
	const order = getOrderById(orderId);
	return !!order && order.guild === guild && order.leader === member;
}

// ----- Points aggregation -----

function getMemberTotals(members: Snowflake[]): { [member: string]: { points: number, wins: number } } {
	const result: { [member: string]: { points: number, wins: number } } = {};
	for (const member of members) result[member] = {points: 0, wins: 0};
	if (members.length === 0) return result;
	const placeholders = members.map(() => "?").join(",");
	const rows = database.prepare<Snowflake[], { member: Snowflake, points: number, wins: number }>(`SELECT member, points, wins FROM global_points WHERE member IN (${placeholders})`).all(...members);
	for (const row of rows) result[row.member] = {points: row.points, wins: row.wins};
	return result;
}

export function getOrderLeaderboard(orderId: number, wins: boolean): { member: Snowflake, value: number }[] {
	const members = getOrderMembers(orderId).map(m => m.member);
	const totals = getMemberTotals(members);
	return members.map(member => ({member, value: wins ? totals[member].wins : totals[member].points}))
		.sort((a, b) => b.value - a.value);
}

// ----- Clashes -----

export function snapshotOrder(orderId: number): ClashSnapshot {
	const members = getOrderMembers(orderId).map(m => m.member);
	return {members, perMember: getMemberTotals(members)};
}

function scoreSnapshot(snapshot: ClashSnapshot, raceType: RaceType): number {
	const current = getMemberTotals(snapshot.members);
	let total = 0;
	for (const member of snapshot.members) {
		const before = snapshot.perMember[member] || {points: 0, wins: 0};
		const now = current[member] || {points: 0, wins: 0};
		const pointsDelta = Math.max(0, now.points - before.points);
		const winsDelta = Math.max(0, now.wins - before.wins);
		if (raceType === "points") total += pointsDelta;
		else if (raceType === "wins") total += winsDelta;
		else total += pointsDelta + winsDelta;
	}
	return total;
}

export function getActiveClashForOrder(orderId: number): ClashRow | null {
	return database.prepare<[number, number], ClashRow>("SELECT * FROM clashes WHERE active = 1 AND (order_a = ? OR order_b = ?)").get(orderId, orderId) || null;
}

export function getLatestClashForOrder(orderId: number): ClashRow | null {
	return database.prepare<[number, number], ClashRow>("SELECT * FROM clashes WHERE order_a = ? OR order_b = ? ORDER BY start_time DESC LIMIT 1").get(orderId, orderId) || null;
}

export function declareClash(guild: Snowflake, orderA: number, orderB: number, raceType: RaceType, startedBy: Snowflake, durationMs: number): ClashRow {
	const now = Date.now();
	const snapshotA = JSON.stringify(snapshotOrder(orderA));
	const snapshotB = JSON.stringify(snapshotOrder(orderB));
	const result = database.prepare("INSERT INTO clashes (guild, order_a, order_b, race_type, started_by, start_time, end_time, active, snapshot_a, snapshot_b) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
		.run(guild, orderA, orderB, raceType, startedBy, now, now + durationMs, snapshotA, snapshotB);
	return database.prepare<[number], ClashRow>("SELECT * FROM clashes WHERE id = ?").get(result.lastInsertRowid as number) as ClashRow;
}

export function getDueClashes(): ClashRow[] {
	return database.prepare<[number], ClashRow>("SELECT * FROM clashes WHERE active = 1 AND end_time <= ?").all(Date.now());
}

export function resolveClash(clash: ClashRow): ClashResult {
	// Flip inactive immediately, before any scoring/Discord work, so an overlapping poll tick can't resolve this clash twice.
	database.prepare("UPDATE clashes SET active = 0 WHERE id = ?").run(clash.id);

	const snapshotA: ClashSnapshot = JSON.parse(clash.snapshot_a);
	const snapshotB: ClashSnapshot = JSON.parse(clash.snapshot_b);
	const scoreA = scoreSnapshot(snapshotA, clash.race_type);
	const scoreB = scoreSnapshot(snapshotB, clash.race_type);
	const winnerOrder = scoreA === scoreB ? 0 : (scoreA > scoreB ? clash.order_a : clash.order_b);

	database.prepare("UPDATE clashes SET winner_order = ?, score_a = ?, score_b = ?, resolved_at = ? WHERE id = ?")
		.run(winnerOrder, scoreA, scoreB, Date.now(), clash.id);

	return {clash, scoreA, scoreB, winnerOrder};
}
