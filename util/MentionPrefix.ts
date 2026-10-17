import {ClientUser} from "discord.js";

/**
 * Strips a leading bot mention (`<@id>` or `<@!id>`) from message content. Shared by the legacy free-text
 * shorthand chain (EntryMessageHandler.ts) and the prefix-command dispatcher (PrefixDispatcher.ts) so the two
 * never drift on what counts as a mention prefix - they used to each hand-roll this check separately.
 *
 * Returns the remainder (not trimmed) if `content` starts with a mention of `botUser`, otherwise null.
 */
export function stripMentionPrefix(content: string, botUser: ClientUser | null): string | null {
	if (!botUser) return null;
	const withBang = `<@!${botUser.id}>`;
	const plain = `<@${botUser.id}>`;
	if (content.startsWith(withBang)) return content.substring(withBang.length);
	if (content.startsWith(plain)) return content.substring(plain.length);
	return null;
}
