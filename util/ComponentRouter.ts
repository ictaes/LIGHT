import {AnySelectMenuInteraction, ButtonInteraction, Interaction, MessageFlags, ModalSubmitInteraction} from "discord.js";

/**
 * Routes button, select-menu and modal interactions by customId instead of having every feature inspect the
 * raw string itself.
 *
 * customIds are `namespace:action` followed by zero or more `:`-separated arguments. Routing on the id rather
 * than an in-memory collector is what makes components survive a restart - which matters because the bot is
 * restarted on every deploy, and a confirmation button that stops working after a restart is worse than no
 * button at all.
 */

const SEPARATOR = ":";

/**
 * Discord rejects customIds longer than 100 characters. The rejection happens when the *message is sent*,
 * which is usually far away from the code that chose to put a long argument in the id - so buildCustomId
 * checks it at construction instead.
 */
export const MAX_CUSTOM_ID_LENGTH = 100;

export type ComponentInteraction = ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction;

export type ComponentHandler = (interaction: ComponentInteraction, args: string[]) => Promise<void>;

/** Matches a raw customId. Used only for the pre-router ids that are already live in Discord messages. */
export type LegacyHandler = (interaction: Interaction) => Promise<void>;

const handlers = new Map<string, ComponentHandler>();
const legacyHandlers: { name: string, handle: LegacyHandler }[] = [];

function key(namespace: string, action: string): string {
	return `${namespace}${SEPARATOR}${action}`;
}

export function registerComponent(namespace: string, action: string, handle: ComponentHandler): void {
	const id = key(namespace, action);
	if (handlers.has(id)) throw new Error(`Component handler "${id}" is already registered`);
	handlers.set(id, handle);
}

/**
 * Escape hatch for the claim buttons, whose ids predate this router and are baked into messages that are
 * already sitting in people's channels. Changing those ids would leave the existing messages inert, so they
 * keep their raw-string matching and are simply consulted after namespaced routing finds nothing.
 */
export function registerLegacyComponent(name: string, handle: LegacyHandler): void {
	legacyHandlers.push({name, handle});
}

/**
 * Builds a customId, rejecting anything Discord or the parser cannot represent.
 *
 * Arguments may not contain the separator: `buildCustomId("a", "b", "x:y")` would otherwise parse back as
 * three arguments and silently hand the handler the wrong data.
 */
export function buildCustomId(namespace: string, action: string, ...args: (string | number)[]): string {
	if (!namespace || !action) throw new Error("customId needs both a namespace and an action");
	const parts = [namespace, action, ...args.map(String)];
	for (const part of parts) {
		if (part.includes(SEPARATOR)) throw new Error(`customId part "${part}" must not contain "${SEPARATOR}"`);
	}
	const id = parts.join(SEPARATOR);
	if (id.length > MAX_CUSTOM_ID_LENGTH) {
		throw new Error(`customId "${id}" is ${id.length} characters, over Discord's limit of ${MAX_CUSTOM_ID_LENGTH}`);
	}
	return id;
}

export interface ParsedCustomId {
	namespace: string;
	action: string;
	args: string[];
}

/** Returns null for ids that are not in router form, including the legacy underscore-separated ones. */
export function parseCustomId(customId: string): ParsedCustomId | null {
	const parts = customId.split(SEPARATOR);
	if (parts.length < 2 || !parts[0] || !parts[1]) return null;
	return {namespace: parts[0], action: parts[1], args: parts.slice(2)};
}

export function isComponentInteraction(interaction: Interaction): interaction is ComponentInteraction {
	return interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit();
}

/**
 * Dispatches an interaction. Returns true if a namespaced handler claimed it.
 *
 * Handler errors are caught and reported to the user rather than left to crash the listener: an unhandled
 * rejection here would take down the whole bot process over one misbehaving button.
 */
export async function handleComponentInteraction(interaction: Interaction): Promise<boolean> {
	if (!isComponentInteraction(interaction)) return false;
	const parsed = parseCustomId(interaction.customId);
	if (parsed) {
		const handle = handlers.get(key(parsed.namespace, parsed.action));
		if (handle) {
			try {
				await handle(interaction, parsed.args);
			} catch (e) {
				console.error(`Component handler "${interaction.customId}" failed:`, e);
				await reportFailure(interaction);
			}
			return true;
		}
	}
	for (const legacy of legacyHandlers) {
		await legacy.handle(interaction).catch(e => console.error(`Legacy component handler "${legacy.name}" failed:`, e));
	}
	return false;
}

async function reportFailure(interaction: ComponentInteraction): Promise<void> {
	const message = {content: "An internal error occurred!", embeds: [], components: []};
	try {
		if (interaction.deferred || interaction.replied) await interaction.editReply(message);
		else await interaction.reply({...message, flags: MessageFlags.Ephemeral});
	} catch {
		//The interaction token may already be dead; nothing useful is left to do.
	}
}

/** Exposed for the registration smoke test. */
export function getRegisteredComponents(): string[] {
	return [...handlers.keys()].sort();
}
