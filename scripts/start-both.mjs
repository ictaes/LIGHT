// Runs both LIGHT processes - the bot and the win feeder - from one entry point.
//
// start-bot.bat does this locally via two separate console windows, which isn't an option on a host like
// Wispbyte whose startup command is a single `node <file>`. This spawns both as child processes instead,
// with the same cwd each already assumes (build/ for the bot, repo root for the feeder - see PointManager.ts's
// "./ranking.db" and feeder.cjs's __dirname-relative reads), pipes their output through to this process's own
// stdout/stderr so a host watching one process sees both logs, and forwards a stop signal to both so a panel
// restart doesn't orphan one of them.
//
// Usage: node scripts/start-both.mjs   (run from the repo root, after `npm run build`)
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(name, args, cwd) {
	const child = spawn(process.execPath, args, {cwd, stdio: "inherit"});
	child.on("exit", (code, signal) => {
		console.error(`[start-both] ${name} exited (code ${code}, signal ${signal}) ${shuttingDown ? "" : "- the other process is still running, which usually isn't what you want"}`);
	});
	child.on("error", err => console.error(`[start-both] ${name} failed to start:`, err));
	return child;
}

const bot = run("bot", ["PointManager.js"], join(root, "build"));
const feeder = run("feeder", ["feeder.cjs"], root);
const children = [bot, feeder];

let shuttingDown = false;

function shutdown(signal) {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`[start-both] received ${signal}, stopping both processes`);
	for (const child of children) child.kill(signal);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
	process.on(signal, () => shutdown(signal));
}

let exitedCount = 0;
let exitCode = 0;
for (const child of children) {
	child.on("exit", code => {
		exitedCount++;
		if (code) exitCode = code;
		if (exitedCount === children.length) process.exit(exitCode);
	});
}
