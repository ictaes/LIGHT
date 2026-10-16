import {Snowflake} from "discord.js";
import * as db from "../db/DataBaseManager.js";

const database = db.getProvider();

const TICK_MS = 1000;
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 30_000;

/**
 * Durable task kinds. Add a member here when you add a handler - keeping it a closed union means a typo in a
 * schedule() call is a compile error rather than a task that silently never runs.
 *
 * Currently empty: no feature schedules a durable task today. BanCommand.ts/TimeoutCommand.ts rely on
 * Discord's own native ban/timeout expiry instead. Add members back here (and register a handler) when a
 * feature actually needs durable scheduling.
 */
export type TaskType = never;

export interface ScheduledTaskRow {
	id: number;
	guild: Snowflake | null;
	type: string;
	payload: string;
	run_at: number;
	attempts: number;
	created_at: number;
}

type Handler = (payload: any, task: ScheduledTaskRow) => Promise<void>;

interface Sweep {
	name: string;
	intervalMs: number;
	run: () => Promise<void>;
	lastRun: number;
}

const handlers = new Map<string, Handler>();
const sweeps: Sweep[] = [];
let timer: NodeJS.Timeout | null = null;
let ticking = false;

/**
 * Registers the handler for a durable task type.
 *
 * Handlers MUST be idempotent. A task is deleted only after its handler resolves, so a crash mid-handler
 * leaves the row in place and it will run again on the next boot. That is the deliberate trade: running a
 * reversible action twice is harmless, whereas dropping one could leave a durable effect never undone.
 */
export function registerHandler<P = unknown>(type: TaskType, handle: (payload: P, task: ScheduledTaskRow) => Promise<void>): void {
	if (handlers.has(type)) throw new Error(`Duplicate scheduler handler for "${type}"`);
	handlers.set(type, handle as Handler);
}

/**
 * Registers a periodic in-process sweep, for stateless polling that should restart from scratch each boot
 * (resolving due clashes, evicting stale rate-limit counters). Deliberately not persisted: a self-rewriting
 * row every few seconds would churn the WAL for no benefit, since the sweep is re-registered from code anyway.
 */
export function registerSweep(name: string, intervalMs: number, run: () => Promise<void>): void {
	if (sweeps.some(sweep => sweep.name === name)) throw new Error(`Duplicate scheduler sweep "${name}"`);
	//lastRun seeded to now so a sweep does not fire immediately on boot, when caches are still cold.
	sweeps.push({name, intervalMs, run, lastRun: Date.now()});
}

/** Queues a durable one-off task. Returns its id, for later cancel(). */
export function schedule(type: TaskType, payload: unknown, runAt: number, guild: Snowflake | null = null): number {
	const result = database.prepare("INSERT INTO scheduled_tasks (guild, type, payload, run_at, created_at) VALUES (?, ?, ?, ?, ?)")
		.run(guild, type, JSON.stringify(payload ?? null), Math.round(runAt), Date.now());
	return Number(result.lastInsertRowid);
}

export function cancel(taskId: number): boolean {
	return database.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(taskId).changes > 0;
}

/**
 * Cancels every pending task of a type for a guild, optionally filtered on payload contents.
 * Call this before scheduling a replacement, or repeated triggers stack up duplicate expiries.
 */
export function cancelWhere(type: TaskType, guild: Snowflake, match?: (payload: any) => boolean): number {
	const rows = database.prepare<[string, Snowflake], ScheduledTaskRow>("SELECT * FROM scheduled_tasks WHERE type = ? AND guild = ?").all(type, guild);
	let cancelled = 0;
	for (const row of rows) {
		if (match && !match(parsePayload(row))) continue;
		if (cancel(row.id)) cancelled++;
	}
	return cancelled;
}

export function getPending(type?: TaskType, guild?: Snowflake): ScheduledTaskRow[] {
	if (type && guild) return database.prepare<[string, Snowflake], ScheduledTaskRow>("SELECT * FROM scheduled_tasks WHERE type = ? AND guild = ? ORDER BY run_at").all(type, guild);
	if (type) return database.prepare<[string], ScheduledTaskRow>("SELECT * FROM scheduled_tasks WHERE type = ? ORDER BY run_at").all(type);
	return database.prepare<[], ScheduledTaskRow>("SELECT * FROM scheduled_tasks ORDER BY run_at").all();
}

function parsePayload(task: ScheduledTaskRow): any {
	try {
		return JSON.parse(task.payload);
	} catch {
		return null;
	}
}

function fail(task: ScheduledTaskRow, reason: string) {
	const attempts = task.attempts + 1;
	if (attempts >= MAX_ATTEMPTS) {
		database.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(task.id);
		console.error(`Scheduler: dropping task ${task.id} (${task.type}) after ${attempts} attempts - ${reason}`);
		return;
	}
	database.prepare("UPDATE scheduled_tasks SET attempts = ?, run_at = ? WHERE id = ?").run(attempts, Date.now() + RETRY_BACKOFF_MS, task.id);
	console.error(`Scheduler: task ${task.id} (${task.type}) failed, retry ${attempts}/${MAX_ATTEMPTS} in ${RETRY_BACKOFF_MS / 1000}s - ${reason}`);
}

async function runDueTasks() {
	//Tasks whose time passed while the bot was offline are simply due now, so catch-up needs no special case.
	//Handlers are responsible for tolerating a very stale task.
	const due = database.prepare<[number, number], ScheduledTaskRow>("SELECT * FROM scheduled_tasks WHERE run_at <= ? ORDER BY run_at LIMIT ?")
		.all(Date.now(), BATCH_SIZE);

	for (const task of due) {
		const handler = handlers.get(task.type);
		if (!handler) {
			//Most likely a load-order bug or a removed feature. Don't discard silently - a missing handler
			//could otherwise strand a durable effect that was never followed through on.
			fail(task, `no handler registered for type "${task.type}"`);
			continue;
		}
		try {
			await handler(parsePayload(task), task);
			database.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(task.id);
		} catch (e) {
			fail(task, (e as Error).message);
		}
	}
}

async function runDueSweeps() {
	const now = Date.now();
	for (const sweep of sweeps) {
		if (now - sweep.lastRun < sweep.intervalMs) continue;
		sweep.lastRun = now;
		try {
			await sweep.run();
		} catch (e) {
			console.error(`Scheduler: sweep "${sweep.name}" failed`, e);
		}
	}
}

async function tick() {
	//Guard against re-entrancy: a slow handler must not have a second tick running tasks underneath it.
	if (ticking) return;
	ticking = true;
	try {
		await runDueTasks();
		await runDueSweeps();
	} finally {
		ticking = false;
	}
}

/** Starts the tick. Call once, from ClientReady, after every handler and sweep has been registered. */
export function start(): void {
	if (timer) return;
	timer = setInterval(() => void tick(), TICK_MS);
	const pending = database.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM scheduled_tasks").get();
	console.log(`Scheduler started (${handlers.size} handlers, ${sweeps.length} sweeps, ${pending?.n ?? 0} pending tasks)`);
}

export function stop(): void {
	if (!timer) return;
	clearInterval(timer);
	timer = null;
}
