import {WebhookClient} from "discord.js";
import {client} from "../PointManager.js";
import {sendToFeed} from "./ClaimWinFeed.js";
import {ClanGame} from "./ClanGame.js";
import {getSubscribers} from "./WebhookSubscriptions.js";

//Re-exported so the existing /subscribefeed and /unsubscribefeed call sites keep importing from here.
export {subscribe, unsubscribe} from "./WebhookSubscriptions.js";

let cache: ClanGame[] = [];

export function addToCache(data: string) {
	let message = JSON.parse(data).data;

	//Parse Game Result
	const result: ClanGame = new ClanGame( message );

	//Check that the object has been initialised to non default values
	if ( result.isDefault ) return;
	clearCache();

	const msg = `**${result.clan}**    ${result.map}    ${result.contest ? "2 x " : ""}${result.playerCount}  [${result.prevClanPoints}->${result.currClanPoints}]`;
	sendToSubscribers(result.clan, msg);
	sendToSubscribers("ALL", msg);
	sendToFeed(result.clan, msg, result.playerCount * (result.contest ? 2 : 1), result).catch(() => {});

	cache.push(result);
}

function sendToSubscribers(clan: string, message: string) {
	for (const webhook of getSubscribers(clan)) {
		const wh = new WebhookClient({url: webhook});
		wh.send({
			content: message,
			username: client.user?.username,
			avatarURL: client.user?.displayAvatarURL()
		}).catch(() => {});
	}
}

export function getCacheForClan(clan: string): ClanGame[] {
	return cache.filter(entry => entry.clan === clan);
}

export function clearCache() {
	cache = cache.filter(entry => entry.timestamp + 300000 > Date.now()); //5 minutes
}