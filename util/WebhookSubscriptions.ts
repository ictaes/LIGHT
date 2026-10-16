//Which webhook URLs want game results for which clan. Pure in-memory state, seeded from settings.json at
//startup and updated by /subscribefeed and /unsubscribefeed.
//
//This lives on its own, with no imports at all, for a structural reason: BotSettingProvider seeds it while
//loading settings, and it used to do that by importing GameDataDistributor - which imports the Discord
//client. That put client.login() on the import path of anything that reads a guild's settings, which is
//most of the codebase. Keeping the state here and the sending in GameDataDistributor breaks that edge
//without an initialisation-order seam.

const subscribers: { [clan: string]: string[] } = {};

export function subscribe(clan: string, webhook: string): void {
	if (!subscribers.hasOwnProperty(clan)) {
		subscribers[clan] = [];
	}
	if (!subscribers[clan].includes(webhook)) {
		subscribers[clan].push(webhook);
	}
}

export function unsubscribe(clan: string, webhook: string): void {
	if (subscribers.hasOwnProperty(clan)) {
		subscribers[clan] = subscribers[clan].filter(w => w !== webhook);
	}
}

export function getSubscribers(clan: string): string[] {
	return subscribers[clan] || [];
}
