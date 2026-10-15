import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
	buildCustomId, getRegisteredComponents, handleComponentInteraction, isComponentInteraction,
	MAX_CUSTOM_ID_LENGTH, parseCustomId, registerComponent, registerLegacyComponent
} from "../build/util/ComponentRouter.js";

//The router keeps one module-level handler map, so each test uses its own namespace rather than resetting it.
function fakeButton(customId) {
	const calls = {replied: false, deferred: false, replies: [], edits: []};
	return {
		customId,
		isButton: () => true,
		isAnySelectMenu: () => false,
		isModalSubmit: () => false,
		get replied() { return calls.replied; },
		get deferred() { return calls.deferred; },
		reply: async message => { calls.replied = true; calls.replies.push(message); },
		editReply: async message => { calls.edits.push(message); },
		calls
	};
}

describe("buildCustomId", () => {
	it("joins namespace, action and arguments with colons", () => {
		assert.equal(buildCustomId("antinuke", "confirm", "enable", 7), "antinuke:confirm:enable:7");
	});

	it("rejects an argument containing the separator, which would parse back as two arguments", () => {
		assert.throws(() => buildCustomId("ns", "act", "a:b"), /must not contain/);
	});

	it("requires both a namespace and an action", () => {
		assert.throws(() => buildCustomId("", "act"), /namespace and an action/);
		assert.throws(() => buildCustomId("ns", ""), /namespace and an action/);
	});

	it("rejects ids over Discord's limit at build time rather than at send time", () => {
		const justFits = buildCustomId("ns", "act", "x".repeat(MAX_CUSTOM_ID_LENGTH - "ns:act:".length));
		assert.equal(justFits.length, MAX_CUSTOM_ID_LENGTH);
		assert.throws(() => buildCustomId("ns", "act", "x".repeat(MAX_CUSTOM_ID_LENGTH)), /over Discord's limit/);
	});
});

describe("parseCustomId", () => {
	it("round-trips what buildCustomId produces", () => {
		const parsed = parseCustomId(buildCustomId("tickets", "close", "123", "456"));
		assert.deepEqual(parsed, {namespace: "tickets", action: "close", args: ["123", "456"]});
	});

	it("returns an empty argument list when there are none", () => {
		assert.deepEqual(parseCustomId("ns:act"), {namespace: "ns", action: "act", args: []});
	});

	it("rejects the legacy underscore ids so they fall through to the legacy handlers", () => {
		assert.equal(parseCustomId("claim"), null);
		assert.equal(parseCustomId("claim_factor_0"), null);
		assert.equal(parseCustomId("claim_channel"), null);
	});

	it("rejects ids with an empty namespace or action", () => {
		assert.equal(parseCustomId(":act"), null);
		assert.equal(parseCustomId("ns:"), null);
	});
});

describe("registerComponent", () => {
	it("refuses a duplicate registration instead of letting one handler shadow the other", () => {
		registerComponent("dupe", "act", async () => {});
		assert.throws(() => registerComponent("dupe", "act", async () => {}), /already registered/);
	});

	it("reports what is registered", () => {
		registerComponent("listed", "act", async () => {});
		assert.ok(getRegisteredComponents().includes("listed:act"));
	});
});

describe("handleComponentInteraction", () => {
	it("passes the parsed arguments to the matching handler", async () => {
		let received;
		registerComponent("routed", "go", async (interaction, args) => { received = args; });
		const claimed = await handleComponentInteraction(fakeButton("routed:go:alpha:beta"));
		assert.equal(claimed, true);
		assert.deepEqual(received, ["alpha", "beta"]);
	});

	it("ignores interactions that are not components", async () => {
		const notAComponent = {isButton: () => false, isAnySelectMenu: () => false, isModalSubmit: () => false};
		assert.equal(await handleComponentInteraction(notAComponent), false);
	});

	it("contains a throwing handler and tells the user, rather than crashing the process", async () => {
		registerComponent("boom", "go", async () => { throw new Error("handler exploded"); });
		const interaction = fakeButton("boom:go");
		const claimed = await handleComponentInteraction(interaction);
		assert.equal(claimed, true);
		assert.equal(interaction.calls.replies.length, 1);
		assert.match(interaction.calls.replies[0].content, /internal error/);
	});

	it("falls through to the legacy handlers for an unrouted id", async () => {
		const seen = [];
		registerLegacyComponent("test_legacy", async interaction => { seen.push(interaction.customId); });
		const claimed = await handleComponentInteraction(fakeButton("claim_factor_2"));
		assert.equal(claimed, false, "legacy ids must not be reported as routed");
		assert.deepEqual(seen, ["claim_factor_2"]);
	});

	it("does not run the legacy handlers once a namespaced handler claims the id", async () => {
		const seen = [];
		registerComponent("claimed", "go", async () => {});
		registerLegacyComponent("test_legacy_skipped", async interaction => { seen.push(interaction.customId); });
		await handleComponentInteraction(fakeButton("claimed:go"));
		assert.deepEqual(seen, []);
	});
});

describe("isComponentInteraction", () => {
	it("accepts buttons, select menus and modals", () => {
		const kinds = ["isButton", "isAnySelectMenu", "isModalSubmit"];
		for (const kind of kinds) {
			const interaction = Object.fromEntries(kinds.map(k => [k, () => k === kind]));
			assert.equal(isComponentInteraction(interaction), true, `${kind} should be a component`);
		}
	});
});
