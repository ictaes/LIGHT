import {ApplicationCommandOptionType, GuildBasedChannel, Message, Role, Snowflake, User} from "discord.js";

/**
 * The subset of `SlashCommandBuilder.toJSON()`'s shape this module actually reads. Matches the real
 * discord-api-types `APIApplicationCommandOption` loosely on purpose - `SlashCommandLike.toJSON()` is typed
 * `any` (see CommandInterface.ts), so there is nothing upstream to structurally match against.
 */
export interface PrefixOptionSchema {
	name: string;
	type: ApplicationCommandOptionType;
	required?: boolean;
	min_value?: number;
	max_value?: number;
	options?: PrefixOptionSchema[];
}

export type PrefixParseResult =
	| { ok: true, resolver: PrefixOptionsResolver }
	| { ok: false, error: string };

type OptionValue = string | number | boolean | User | Role | GuildBasedChannel;

/**
 * Duck-types as the handful of `CommandInteractionOptionResolver` methods every command file actually calls
 * on `(context.base as ChatInputCommandInteraction).options` - confirmed by grepping every command file for
 * `interaction.options.get` call sites. Nothing else needs implementing.
 */
export class PrefixOptionsResolver {
	constructor(private readonly subcommand: string | null, private readonly values: Map<string, OptionValue>) {
	}

	getSubcommand(required: boolean = true): string | null {
		if (required && this.subcommand === null) throw new Error("No subcommand provided");
		return this.subcommand;
	}

	getString(name: string, required: boolean = false): string | null {
		return this.get<string>(name, required, "string");
	}

	getInteger(name: string, required: boolean = false): number | null {
		return this.get<number>(name, required, "number");
	}

	getNumber(name: string, required: boolean = false): number | null {
		return this.get<number>(name, required, "number");
	}

	getBoolean(name: string, required: boolean = false): boolean | null {
		return this.get<boolean>(name, required, "boolean");
	}

	getUser(name: string, required: boolean = false): User | null {
		return this.get<User>(name, required, "object");
	}

	getRole(name: string, required: boolean = false): Role | null {
		return this.get<Role>(name, required, "object");
	}

	getChannel(name: string, required: boolean = false): GuildBasedChannel | null {
		return this.get<GuildBasedChannel>(name, required, "object");
	}

	private get<T>(name: string, required: boolean, typeofTag: string): T | null {
		const value = this.values.get(name);
		if (value === undefined) {
			if (required) throw new Error(`Missing required option "${name}"`);
			return null;
		}
		return value as T;
	}
}

const MENTION_PATTERNS = {
	user: /^<@!?(\d{17,20})>$/,
	role: /^<@&(\d{17,20})>$/,
	channel: /^<#(\d{17,20})>$/,
	raw: /^\d{17,20}$/
};

function extractSnowflake(token: string, mention: RegExp): Snowflake | null {
	const match = token.match(mention);
	if (match) return match[1];
	if (MENTION_PATTERNS.raw.test(token)) return token;
	return null;
}

function resolveUser(message: Message, token: string): User | null {
	const id = extractSnowflake(token, MENTION_PATTERNS.user);
	if (!id) return null;
	return message.mentions.users.get(id) ?? message.guild?.members.cache.get(id)?.user ?? message.client.users.cache.get(id) ?? null;
}

function resolveRole(message: Message, token: string): Role | null {
	const id = extractSnowflake(token, MENTION_PATTERNS.role);
	if (!id) return null;
	return message.mentions.roles.get(id) ?? message.guild?.roles.cache.get(id) ?? null;
}

function resolveChannel(message: Message, token: string): GuildBasedChannel | null {
	const id = extractSnowflake(token, MENTION_PATTERNS.channel);
	if (!id) return null;
	const mentioned = message.mentions.channels.get(id);
	if (mentioned && !mentioned.isDMBased()) return mentioned;
	return message.guild?.channels.cache.get(id) ?? null;
}

function optionLabel(option: PrefixOptionSchema): string {
	return option.required ? `<${option.name}>` : `[${option.name}]`;
}

function usageFor(commandName: string, subcommand: string | null, options: PrefixOptionSchema[]): string {
	const parts = [commandName, subcommand, ...options.map(optionLabel)].filter(Boolean);
	return `Usage: ${parts.join(" ")}`;
}

/**
 * Parses the free text after a command/alias token into a PrefixOptionsResolver, using the command's own
 * `slashData.toJSON()` schema to know what to expect - so there is one schema per command, not a hand-written
 * parser per command.
 *
 * Positional, in schema-declaration order. The *last* option, if it is a STRING, greedily consumes all
 * remaining raw text (the "reason field eats the rest of the message" convention old-style text bots use) -
 * every other option consumes exactly one whitespace-delimited token. No quoted-string support in this first
 * pass: a non-last STRING option can only ever be a single word.
 */
export function parsePrefixOptions(commandName: string, schema: PrefixOptionSchema[], rawText: string, message: Message): PrefixParseResult {
	const subcommandSchema = schema.find(option => option.type === ApplicationCommandOptionType.Subcommand);
	let subcommand: string | null = null;
	let options = schema;
	let remaining = rawText.trim();

	if (subcommandSchema) {
		const spaceIndex = remaining.indexOf(" ");
		const token = spaceIndex === -1 ? remaining : remaining.substring(0, spaceIndex);
		const match = schema.find(option => option.type === ApplicationCommandOptionType.Subcommand && option.name === token);
		if (!match) {
			const names = schema.filter(o => o.type === ApplicationCommandOptionType.Subcommand).map(o => o.name).join(", ");
			return {ok: false, error: token ? `Unknown subcommand "${token}". Available: ${names}` : `Usage: ${commandName} <${names}> ...`};
		}
		subcommand = match.name;
		options = match.options ?? [];
		remaining = spaceIndex === -1 ? "" : remaining.substring(spaceIndex + 1).trim();
	}

	const values = new Map<string, OptionValue>();
	for (let i = 0; i < options.length; i++) {
		const option = options[i];
		const isLast = i === options.length - 1;
		const isGreedyString = isLast && option.type === ApplicationCommandOptionType.String;

		let token: string;
		if (isGreedyString) {
			token = remaining;
			remaining = "";
		} else {
			const spaceIndex = remaining.indexOf(" ");
			token = spaceIndex === -1 ? remaining : remaining.substring(0, spaceIndex);
			remaining = spaceIndex === -1 ? "" : remaining.substring(spaceIndex + 1).trim();
		}

		if (token === "") {
			if (option.required) return {ok: false, error: usageFor(commandName, subcommand, options)};
			continue;
		}

		const parsed = parseValue(option, token, message);
		if (parsed === undefined) return {ok: false, error: `"${token}" is not a valid ${describeType(option.type)} for "${option.name}". ${usageFor(commandName, subcommand, options)}`};
		values.set(option.name, parsed);
	}

	return {ok: true, resolver: new PrefixOptionsResolver(subcommand, values)};
}

function parseValue(option: PrefixOptionSchema, token: string, message: Message): OptionValue | undefined {
	switch (option.type) {
		case ApplicationCommandOptionType.String:
			return token;
		case ApplicationCommandOptionType.Integer:
		case ApplicationCommandOptionType.Number: {
			const value = option.type === ApplicationCommandOptionType.Integer ? parseInt(token, 10) : parseFloat(token);
			if (Number.isNaN(value)) return undefined;
			if (option.min_value !== undefined && value < option.min_value) return undefined;
			if (option.max_value !== undefined && value > option.max_value) return undefined;
			return value;
		}
		case ApplicationCommandOptionType.Boolean: {
			const lower = token.toLowerCase();
			if (["true", "yes", "1"].includes(lower)) return true;
			if (["false", "no", "0"].includes(lower)) return false;
			return undefined;
		}
		case ApplicationCommandOptionType.User:
			return resolveUser(message, token) ?? undefined;
		case ApplicationCommandOptionType.Role:
			return resolveRole(message, token) ?? undefined;
		case ApplicationCommandOptionType.Channel:
			return resolveChannel(message, token) ?? undefined;
		default:
			//Mentionable/Attachment/SubcommandGroup: not used by any command today (verified by grep), so not
			//worth a parser - fail closed rather than silently mis-parse.
			return undefined;
	}
}

function describeType(type: ApplicationCommandOptionType): string {
	switch (type) {
		case ApplicationCommandOptionType.Integer:
			return "whole number";
		case ApplicationCommandOptionType.Number:
			return "number";
		case ApplicationCommandOptionType.Boolean:
			return "true/false value";
		case ApplicationCommandOptionType.User:
			return "member (mention or ID)";
		case ApplicationCommandOptionType.Role:
			return "role (mention or ID)";
		case ApplicationCommandOptionType.Channel:
			return "channel (mention or ID)";
		default:
			return "value";
	}
}
