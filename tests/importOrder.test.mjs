import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {execFileSync} from "child_process";
import {copyFileSync, mkdtempSync, rmSync, writeFileSync} from "fs";
import {tmpdir} from "os";
import path from "path";
import {pathToFileURL} from "url";
import {fileURLToPath} from "url";

//These modules form an import cycle: RewardManager -> LogUtil -> BotSettingProvider -> RewardManager.
//ESM tolerates that, but only if nothing reaches across the cycle at module-evaluation time. It did once,
//and the bot died on boot with "Cannot access 'rewards' before initialization" - while the rest of the test
//suite passed, because those tests happened to enter the graph through PermissionUtil, which pulls the
//modules in a different and accidentally working order.
//
//So the entry point is the variable under test. Node caches modules per process, so each order needs its
//own process.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = pathToFileURL(path.join(root, "build")).href;

//PointManager is deliberately absent: importing it logs a second bot in. Every module below is one the
//cycle actually runs through.
const entryPoints = [
	["RewardManager", "/util/RewardManager.js"],
	["LogUtil", "/util/LogUtil.js"],
	["BotSettingProvider", "/BotSettingProvider.js"],
	["PermissionUtil", "/util/PermissionUtil.js"],
	["ModerationUtil", "/util/ModerationUtil.js"],
	["WebhookSubscriptions", "/util/WebhookSubscriptions.js"]
];

/**
 * Imports `entry` first, then BotSettingProvider, and exercises it. Runs in a scratch cwd because
 * DataBaseManager and Config both read process.cwd().
 */
function bootThrough(entry) {
	const scratch = mkdtempSync(path.join(tmpdir(), "light-boot-"));
	copyFileSync(path.join(root, "config.json"), path.join(scratch, "config.json"));
	//At least one guild is essential, not incidental. The crash happens inside the per-guild loop that
	//calls RewardManager.loadRewards, so with an empty settings.json the loop never runs and this test
	//passes against code that cannot boot. It was written that way first and proved exactly that.
	writeFileSync(path.join(scratch, "settings.json"), JSON.stringify([{guild_id: "000000000000000000"}]));
	try {
		const script = `
			await import(${JSON.stringify(build + entry)});
			const {getServerContext, getGuildsForClan} = await import(${JSON.stringify(build + "/BotSettingProvider.js")});
			getServerContext("000000000000000000");
			getGuildsForClan("TEST");
			console.log("ok");
		`;
		const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
			cwd: scratch, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000
		});
		return {ok: out.includes("ok"), output: out};
	} catch (e) {
		return {ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}`};
	} finally {
		try {
			rmSync(scratch, {recursive: true, force: true});
		} catch {
			//Windows holds the scratch ranking.db open; the OS reclaims the temp dir.
		}
	}
}

describe("module import order", () => {
	for (const [name, entry] of entryPoints) {
		it(`settings load when the graph is entered through ${name}`, () => {
			const result = bootThrough(entry);
			assert.ok(result.ok, `entering through ${name} failed:\n${result.output}`);
		});

		it(`entering through ${name} does not start the bot`, () => {
			//"Listening on port 34583" means something reached PointManager and a second instance is live.
			const result = bootThrough(entry);
			assert.ok(!result.output.includes("Listening on port"), `entering through ${name} started the bot:\n${result.output}`);
		});
	}
});
