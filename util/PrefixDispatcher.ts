import {Message} from "discord.js";
import {client, getRegisteredCommand, isRegisteredCommandName} from "../PointManager.js";
import {BaseUserContext} from "./BaseUserContext.js";
import {BotUserContext} from "./BotUserContext.js";
import type {PointCommand} from "./CommandInterface.js";
import {sendUninitializedError} from "./EmbedUtil.js";
import {stripMentionPrefix} from "./MentionPrefix.js";
import {getAlias, getPrefixConfig} from "./PrefixConfigUtil.js";
import {parsePrefixOptions, PrefixOptionSchema} from "./PrefixOptionsResolver.js";
import {PrefixInvocation} from "./PrefixInvocation.js";

/**
 * Lets every slash command also be invoked as `<prefix>command args...` or `@LIGHT command args...`, without
 * any of the 40 command files knowing the difference - see PrefixInvocation.ts for how that bridge works.
 *
 * Returns true if the message was a recognised command/alias invocation (handled, whether it succeeded or
 * errored) and the caller should stop processing this message. Returns false for anything else, so the
 * caller falls through unchanged to the legacy free-text shorthand chain in EntryMessageHandler.ts - that is
 * what keeps forms like `@LIGHT 500` or `@LIGHT p` working exactly as before: their first word is never a
 * registered command or alias name, so they never reach this function's dispatch path.
 */
export async function tryPrefixDispatch(context: BaseUserContext, message: Message): Promise<boolean> {
	if (!message.guild) return false;
	const rest = computeRest(message);
	if (rest === null || rest === "") return false;

	const spaceIndex = rest.indexOf(" ");
	const token = (spaceIndex === -1 ? rest : rest.substring(0, spaceIndex)).toLowerCase();
	const argsText = spaceIndex === -1 ? "" : rest.substring(spaceIndex + 1);

	const resolvedName = getAlias(message.guild.id, token) ?? (isRegisteredCommandName(token) ? token : undefined);
	if (!resolvedName) return false;
	const command = getRegisteredCommand(resolvedName);
	if (!command) return false;

	//"manual" implies showModal(), which needs a real interaction - nothing opts into this today (verified by
	//grep), but fail loudly with a clear message rather than silently mis-executing if something ever does.
	if (command.responseMode && command.responseMode !== "defer") {
		await context.reply("This command isn't available as a text command - use the slash command instead.");
		return true;
	}

	const schema = (command.slashData.toJSON().options ?? []) as PrefixOptionSchema[];
	const parsed = parsePrefixOptions(token, schema, argsText, message);
	if (!parsed.ok) {
		await context.reply(parsed.error);
		return true;
	}

	//Swap the already-built context's base for the parsed invocation. Guild/user/member/channel were already
	//resolved correctly from the real message by getUser() before this function was called - only the
	//`.options` surface commands read their arguments from needs to change.
	context.base = new PrefixInvocation(message, parsed.resolver);

	//Mirrors the InteractionCreate dispatcher's narrowing pattern in PointManager.ts: checking `requiresUser`
	//narrows the command union to one arm, and the instanceof check narrows the context to match it, so
	//`execute` can be called without a cast.
	let run: () => Promise<void>;
	if (command.requiresUser) {
		if (!(context instanceof BotUserContext)) {
			await context.reply(sendUninitializedError(context.user));
			return true;
		}
		const pointCommand: PointCommand = command;
		const pointContext: BotUserContext = context;
		run = () => pointCommand.execute(pointContext);
	} else {
		const genericCommand = command;
		run = () => genericCommand.execute(context);
	}

	try {
		await run();
	} catch (e) {
		console.error(e);
		await context.reply("An internal error occurred!");
	}
	return true;
}

/**
 * A message triggers prefix dispatch if it starts with a bot mention (always allowed - explicit by
 * construction, so no guild opt-in needed) or the guild's configured+enabled custom prefix (opt-in via
 * /prefix set, ships with no effect otherwise - consistent with every other new subsystem in this project).
 */
function computeRest(message: Message): string | null {
	const mentionRest = stripMentionPrefix(message.content, client.user);
	if (mentionRest !== null) return mentionRest.trim();
	if (!message.guild) return null;
	const config = getPrefixConfig(message.guild.id);
	if (config && config.enabled && config.prefix && message.content.startsWith(config.prefix)) {
		return message.content.substring(config.prefix.length).trim();
	}
	return null;
}
