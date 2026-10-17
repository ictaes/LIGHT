import {Message} from "discord.js";
import {PrefixOptionsResolver} from "./PrefixOptionsResolver.js";

/**
 * Stands in for a ChatInputCommandInteraction when a command is invoked via the prefix/mention text layer
 * instead of a slash interaction. Every command reads its arguments via
 * `(context.base as ChatInputCommandInteraction).options.getX(...)` - a type assertion, not a structural
 * check - so an object that merely has a compatible `.options` resolver satisfies every existing command
 * file unmodified. See BaseUserContext.ts for the other half: it unwraps `.message` wherever `base` is used
 * for guild/user/member/channel/reply purposes.
 */
export class PrefixInvocation {
	constructor(readonly message: Message, readonly options: PrefixOptionsResolver) {
	}
}
