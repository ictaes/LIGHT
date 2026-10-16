import {Colors, Message} from "discord.js";
import {BotUserContext} from "../util/BotUserContext.js";
import {client, logModAction} from "../PointManager.js";
import {addWarning, recordModAction} from "../util/ModerationUtil.js";

const messageTimestamps = new Map<string, number[]>();

const INVITE_REGEX = /(discord\.gg|discord(?:app)?\.com\/invite)\/\S+/i;
const URL_REGEX = /https?:\/\/\S+/gi;

export async function checkMessage(context: BotUserContext, message: Message): Promise<boolean> {
	const automod = context.getSettings().automod;
	if (!automod.enabled) return false;
	if (context.hasModAccess()) return false;
	if (context.member && context.member.roles.cache.some(r => automod.exempt_roles.includes(r.id))) return false;

	let triggered: string | null = null;

	if (automod.spam?.enabled) {
		const key = `${context.guild.id}:${context.id}`;
		const now = Date.now();
		const windowMs = automod.spam.interval_seconds * 1000;
		const timestamps = (messageTimestamps.get(key) || []).filter(t => now - t < windowMs);
		timestamps.push(now);
		messageTimestamps.set(key, timestamps);
		if (timestamps.length > automod.spam.max_messages) {
			triggered = "sending messages too quickly";
			messageTimestamps.set(key, []);
		}
	}

	if (!triggered && automod.links?.enabled) {
		const hasInvite = INVITE_REGEX.test(message.content);
		if (hasInvite && !automod.links.allow_invites) {
			triggered = "posting a Discord invite link";
		} else {
			const urls = message.content.match(URL_REGEX) || [];
			const blockedUrl = urls.find(url => {
				let hostname: string;
				try {
					hostname = new URL(url).hostname;
				} catch {
					return true;
				}
				return !automod.links!.whitelist.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
			});
			if (blockedUrl) {
				triggered = "posting a link that isn't allowed";
			}
		}
	}

	if (!triggered && automod.caps?.enabled) {
		const letters = message.content.replace(/[^a-zA-Z]/g, "");
		if (letters.length >= automod.caps.min_length) {
			const upper = letters.replace(/[^A-Z]/g, "").length;
			if ((upper / letters.length) * 100 > automod.caps.max_percent) {
				triggered = "excessive use of capital letters";
			}
		}
	}

	if (!triggered && automod.mention_spam?.enabled) {
		const count = message.mentions.users.size + message.mentions.roles.size;
		if (count > automod.mention_spam.max_mentions) {
			triggered = "mentioning too many users/roles";
		}
	}

	if (!triggered) return false;

	await message.delete().catch(() => {
	});

	const moderatorId = client.user?.id || "0";
	recordModAction(context.guild.id, context.id, moderatorId, "automod", triggered);

	if (automod.punishment === "warn") {
		addWarning(context.guild.id, context.id, moderatorId, `Automod: ${triggered}`);
	} else if (automod.punishment === "timeout") {
		if (message.member && message.member.moderatable) {
			await message.member.timeout(automod.timeout_seconds * 1000, `Automod: ${triggered}`).catch(() => {
			});
		}
	}

	logModAction(context, `Automod deleted a message from ${context.user} - ${triggered}`, Colors.Red);
	return true;
}
