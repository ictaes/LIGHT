//Clan leaderboard from territorial.io, used to show where a clan sits after a win.
//
//The game feed carries a clan's own points and gain but not its position, so this is the only source for
//rank and for the clans immediately above and below. The page is plain text:
//
//	Clan Leaderboard
//
//	Fri, 16 Oct 2026 02:01:32 GMT
//
//	Ranking, Name, Points
//
//	1, OG, 28.0010
//	2, CORGI, 17.5748
//
//Same host the feeder already polls, so this adds no new external dependency - but it is still a network
//call on the win-feed path, so every failure mode degrades to "no ranking shown" rather than to an error.

const RANKING_URL = "https://territorial.io/clans";
/** Matches the feeder's poll interval - there is no point holding a fresher copy than the games arrive. */
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;

export interface ClanRank {
	rank: number;
	name: string;
	points: number;
}

export interface RankingContext {
	entry: ClanRank;
	above: ClanRank | null;
	below: ClanRank | null;
}

let cache: ClanRank[] | null = null;
let fetchedAt = 0;
let inFlight: Promise<ClanRank[] | null> | null = null;

/**
 * Parses the leaderboard body. Exported for tests - it is the part most likely to break, because it is
 * parsing someone else's page.
 */
export function parseRanking(body: string): ClanRank[] {
	const ranks: ClanRank[] = [];
	for (const line of body.split("\n")) {
		//Greedy middle group so the LAST comma separates the points. Clan names are user-chosen and may
		//contain commas; splitting on every comma would mangle them.
		const match = line.trim().match(/^(\d+),\s*(.*),\s*([\d.]+)$/);
		if (!match) continue;
		const rank = parseInt(match[1]);
		const points = Number(match[3]);
		if (!Number.isFinite(rank) || !Number.isFinite(points)) continue;
		ranks.push({rank, name: match[2].trim(), points});
	}
	return ranks;
}

async function fetchRanking(): Promise<ClanRank[] | null> {
	try {
		const response = await fetch(RANKING_URL, {signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const parsed = parseRanking(await response.text());
		//An empty parse means the page shape changed. Keeping the previous cache is better than replacing
		//good data with nothing.
		if (parsed.length === 0) throw new Error("no rows parsed - the page format may have changed");
		return parsed;
	} catch (e) {
		console.error("Failed to fetch the clan ranking:", e instanceof Error ? e.message : e);
		return null;
	}
}

/** Returns the cached ranking, refreshing it if stale. Returns null only when no copy has ever loaded. */
export async function getRanking(): Promise<ClanRank[] | null> {
	if (cache && Date.now() - fetchedAt < CACHE_TTL_MS) return cache;
	//One game result fans out to every guild following that clan, so without this each of them would start
	//its own request for the same page at the same moment.
	if (inFlight) return inFlight;

	inFlight = fetchRanking().then(result => {
		if (result) {
			cache = result;
			fetchedAt = Date.now();
		}
		inFlight = null;
		//Serving a stale copy beats showing nothing when the site is briefly unreachable.
		return cache;
	});
	return inFlight;
}

/** Finds a clan and its immediate neighbours, or null if it is not on the board. */
export async function getRankingContext(clan: string): Promise<RankingContext | null> {
	const ranking = await getRanking();
	if (!ranking) return null;

	//Exact match first: clan tags are case-sensitive in principle, and two tags differing only in case
	//would otherwise resolve to whichever came first.
	let index = ranking.findIndex(entry => entry.name === clan);
	if (index === -1) index = ranking.findIndex(entry => entry.name.toLowerCase() === clan.toLowerCase());
	if (index === -1) return null;

	return {
		entry: ranking[index],
		above: ranking[index - 1] ?? null,
		below: ranking[index + 1] ?? null
	};
}

/** Test seam: drops the cache so a test does not depend on whatever a previous one fetched. */
export function resetCache(): void {
	cache = null;
	fetchedAt = 0;
	inFlight = null;
}
