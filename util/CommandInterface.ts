import type {SlashCommandBuilder} from "discord.js";
import type {BaseUserContext} from "./BaseUserContext.js";
import type {BotUserContext} from "./BotUserContext.js";

//Every import here is type-only on purpose, so this module has no runtime dependencies at all. Importing it
//must never pull in PointManager (which logs the bot in as a side effect), otherwise the command definitions
//cannot be inspected by anything except a live bot.

/**
 * How the dispatcher opens the reply for a command.
 *
 * - `defer` (the default when omitted): `deferReply()` before execute, as every command has always done.
 * - `defer_ephemeral`: same, but only the invoker sees the reply.
 * - `manual`: the dispatcher does not touch the interaction. Required for anything calling `showModal()`,
 *   which Discord rejects once a reply has been deferred.
 */
export type ResponseMode = "defer" | "defer_ephemeral" | "manual";

/**
 * Builders for subcommands/options are not `SlashCommandBuilder` - the builder methods return narrower types
 * that drop the subcommand-adding methods - so the registry only relies on the two members it actually uses.
 */
export type SlashCommandLike = SlashCommandBuilder | { name: string, toJSON(): any };

/**
 * The context type is a generic *parameter* rather than a property narrowed by a subinterface. That matters:
 * `execute` is a property holding a function, so narrowing it in a child interface is a contravariant
 * assignment and TypeScript rejects it (TS2430). The previous interfaces suppressed that with a
 * `// @ts-ignore`, which also suppressed every other check on the declaration.
 */
export interface CommandBase<C extends BaseUserContext> {
	requiresUser: boolean,
	responseMode?: ResponseMode,
	slashData: SlashCommandLike,
	execute: (context: C) => Promise<void>,
}

export interface GenericCommand extends CommandBase<BaseUserContext> {
	requiresUser: false
}

export interface PointCommand extends CommandBase<BotUserContext> {
	requiresUser: true
}

/**
 * `requiresUser` is the discriminant: checking it narrows this union to one arm, which is what lets the
 * dispatcher call `execute` with the right context type without a cast.
 */
export type AnyCommand = GenericCommand | PointCommand;

//Commands are declared `export default {...} satisfies PointCommand` - never `as PointCommand`.
//
//`as` is an assertion: it tells the compiler the object already has that type and checks nothing about
//whether the fields are present or correctly typed. That is not a hypothetical problem here - it is how
//`requiresUser` came to be declared on every command while being honoured by none, and the bug sat dormant
//because no error was ever possible. `satisfies` checks the object against the type while still exporting
//the literal type, so a missing or misspelled field is a compile error.
