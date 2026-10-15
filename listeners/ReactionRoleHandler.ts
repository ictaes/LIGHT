import {MessageReaction, PartialMessageReaction, PartialUser, User} from "discord.js";
import * as db from "../db/DataBaseManager.js";

const database = db.getProvider();

function emojiKey(reaction: MessageReaction): string {
	return reaction.emoji.id || reaction.emoji.name || "";
}

async function resolve(reaction: MessageReaction | PartialMessageReaction): Promise<MessageReaction | null> {
	if (!reaction.partial) return reaction;
	return reaction.fetch().catch(() => null);
}

export async function handleReactionAdd(partialReaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
	if (user.bot) return;
	const reaction = await resolve(partialReaction);
	if (!reaction || !reaction.message.guild) return;
	const row = database.prepare<[string, string], { role: string }>("SELECT role FROM reaction_roles WHERE message = ? AND emoji = ?").get(reaction.message.id, emojiKey(reaction));
	if (!row) return;
	const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
	if (!member) return;
	await member.roles.add(row.role).catch(console.error);
}

export async function handleReactionRemove(partialReaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
	if (user.bot) return;
	const reaction = await resolve(partialReaction);
	if (!reaction || !reaction.message.guild) return;
	const row = database.prepare<[string, string], { role: string }>("SELECT role FROM reaction_roles WHERE message = ? AND emoji = ?").get(reaction.message.id, emojiKey(reaction));
	if (!row) return;
	const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
	if (!member) return;
	await member.roles.remove(row.role).catch(console.error);
}
