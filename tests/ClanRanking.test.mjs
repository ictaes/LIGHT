import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {parseRanking} from "../build/util/ClanRanking.js";

//Captured from https://territorial.io/clans on 2026-10-16. The parser reads someone else's page, so this
//keeps a known-good sample of the format it was written against.
const SAMPLE = `Clan Leaderboard

Fri, 16 Oct 2026 02:01:32 GMT

Ranking, Name, Points

1, OG, 28.0010
2, CORGI, 17.5748
3, OMEN, 17.5512
7, FR, 14.0122
8, TITAN, 13.7612
9, TR, 13.4461
23, ?, 8.5567
36, ✝️, 5.9419
56, 胡金豪是GAY, 4.6417
72, G.U, 4.3221
`;

describe("parseRanking", () => {
	const ranks = parseRanking(SAMPLE);

	it("skips the title, timestamp and header rows", () => {
		assert.equal(ranks.length, 10);
		assert.deepEqual(ranks[0], {rank: 1, name: "OG", points: 28.001});
	});

	it("keeps the ranks the page reports rather than renumbering", () => {
		//The sample is deliberately non-contiguous. Row position is not rank.
		assert.deepEqual(ranks.map(r => r.rank), [1, 2, 3, 7, 8, 9, 23, 36, 56, 72]);
	});

	it("handles non-ascii and punctuation clan names", () => {
		const names = ranks.map(r => r.name);
		assert.ok(names.includes("?"));
		assert.ok(names.includes("✝️"));
		assert.ok(names.includes("胡金豪是GAY"));
		assert.ok(names.includes("G.U"), "a dot in a name must not be treated as a number boundary");
	});

	it("splits on the last comma so a name containing one survives", () => {
		//Clan tags are user-chosen. Splitting on every comma would turn this into a mangled name and a
		//NaN score.
		const parsed = parseRanking("4, OH, HI, 12.3456");
		assert.deepEqual(parsed, [{rank: 4, name: "OH, HI", points: 12.3456}]);
	});

	it("ignores malformed lines instead of throwing", () => {
		const parsed = parseRanking("1, OK, 1.0\ngarbage\n\n, , \n2, ALSO OK, 2.0");
		assert.deepEqual(parsed.map(r => r.name), ["OK", "ALSO OK"]);
	});

	it("returns an empty list for an unrecognised page", () => {
		//getRanking treats this as a failure and keeps the previous cache rather than blanking it.
		assert.deepEqual(parseRanking("<html><body>404 Not Found</body></html>"), []);
	});
});
