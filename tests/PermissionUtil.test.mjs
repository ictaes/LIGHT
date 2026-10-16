import assert from "node:assert/strict";
import {after, before, describe, it} from "node:test";
import {copyFileSync, mkdtempSync, rmSync} from "fs";
import {tmpdir} from "os";
import path from "path";
import {fileURLToPath} from "url";

//PermissionUtil used to be impossible to import here: its mod_roles lookup reached BotSettingProvider, which
//imported PointManager, which calls client.login() at module evaluation. Moving logAction/logModAction into
//LogUtil broke that chain. The fact that this file runs at all is the regression test - if the cycle comes
//back, importing the module below logs a second bot instance in and binds port 34583.
//
//Both DataBaseManager and Config read from process.cwd(), so the import happens inside a scratch directory
//to avoid creating a stray ranking.db in the repo root.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let scratch;
let PermissionUtil;

before(async () => {
	scratch = mkdtempSync(path.join(tmpdir(), "light-perm-"));
	//The repo-root config.json is the blank template, not the live one in build/.
	copyFileSync(path.join(root, "config.json"), path.join(scratch, "config.json"));
	process.chdir(scratch);
	//Specifier is resolved relative to this file, not cwd, so the chdir above does not affect it.
	PermissionUtil = await import("../build/util/PermissionUtil.js");
});

after(() => {
	process.chdir(root);
	//Best effort: Windows refuses to remove the directory while better-sqlite3 still holds the scratch
	//ranking.db open, and DataBaseManager has no close(). The OS reclaims the temp dir either way.
	try {
		rmSync(scratch, {recursive: true, force: true});
	} catch {
	}
});

describe("PermissionUtil", () => {
	it("imports without starting the bot", () => {
		assert.ok(PermissionUtil.resolvePermission, "the module should expose resolvePermission");
	});

	it("never offers administrator as a grantable fake permission", () => {
		//Granting administrator through the fake-permission system would let any holder escalate to anything.
		assert.ok(!PermissionUtil.GRANTABLE_PERMISSIONS.includes("administrator"));
	});

	it("never offers manage_antinuke as a grantable fake permission", () => {
		//Otherwise a role handed out through the bot could switch off the protection constraining it.
		assert.ok(!PermissionUtil.GRANTABLE_PERMISSIONS.includes("manage_antinuke"));
	});

	it("offers every other permission", () => {
		const expected = PermissionUtil.ALL_PERMISSIONS.filter(p => p !== "administrator" && p !== "manage_antinuke");
		assert.deepEqual([...PermissionUtil.GRANTABLE_PERMISSIONS].sort(), expected.sort());
	});

	it("rejects an attempt to grant a non-grantable permission", () => {
		assert.throws(() => PermissionUtil.grantFakePermission("g1", "r1", "administrator", "u1"), /cannot be granted/);
		assert.throws(() => PermissionUtil.grantFakePermission("g1", "r1", "manage_antinuke", "u1"), /cannot be granted/);
	});

	it("stores and revokes a grantable permission", () => {
		assert.equal(PermissionUtil.grantFakePermission("g1", "r1", "manage_points", "u1"), true);
		assert.equal(PermissionUtil.grantFakePermission("g1", "r1", "manage_points", "u1"), false, "a repeat grant is not a change");
		assert.deepEqual(PermissionUtil.getFakePermissions("g1", "r1"), ["manage_points"]);
		assert.equal(PermissionUtil.revokeFakePermission("g1", "r1", "manage_points"), true);
		assert.deepEqual(PermissionUtil.getFakePermissions("g1", "r1"), []);
	});

	it("prunes every permission for a deleted role", () => {
		PermissionUtil.grantFakePermission("g2", "r2", "manage_points", "u1");
		PermissionUtil.grantFakePermission("g2", "r2", "manage_messages", "u1");
		assert.equal(PermissionUtil.pruneRole("g2", "r2"), 2);
		assert.deepEqual(PermissionUtil.getFakePermissions("g2", "r2"), []);
	});
});
