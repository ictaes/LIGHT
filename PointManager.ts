import {Client, Collection, ColorResolvable, ContextMenuCommandBuilder, EmbedBuilder, Events, GatewayIntentBits, GuildMember, MessageFlags, REST, RESTPutAPIApplicationCommandsResult, Routes, TextChannel, ApplicationCommandType, ChatInputCommandInteraction} from "discord.js";
import {readdirSync} from "fs";
import {dirname, join} from "path";
import {fileURLToPath} from "url";
import * as rewards from "./util/RewardManager.js";
import * as db from "./db/DataBaseManager.js";
import {sendUninitializedError} from "./util/EmbedUtil.js";
import {handleDialog, hasDialog} from "./util/SetupDisalogUtil.js";
import {BotUserContext, getUser} from "./util/BotUserContext.js";
import {removeServerSetting} from "./BotSettingProvider.js";
import {handleMessage} from "./util/EntryMessageHandler.js";
import {handleFeedInteraction} from "./util/ClaimWinFeed.js";
import {handleChannelInteraction} from "./util/ClaimWinChannel.js";
import {showProfileEmbed} from "./commands/ProfileCommand.js";
import {checkMessage} from "./listeners/MessageAutomod.js";
import {handleMessageDelete, handleMessageUpdate} from "./listeners/MessageAuditLog.js";
import {handleMemberAdd, handleMemberRemove} from "./listeners/MemberAuditLog.js";
import {handleReactionAdd, handleReactionRemove} from "./listeners/ReactionRoleHandler.js";
import {getModLogChannel} from "./util/ModerationUtil.js";
import {start as startScheduler} from "./util/Scheduler.js";
import {pruneRole} from "./util/PermissionUtil.js";
import {AnyCommand, PointCommand, ResponseMode} from "./util/CommandInterface.js";
import {handleComponentInteraction, registerLegacyComponent} from "./util/ComponentRouter.js";
//Re-exported so existing `import {config} from "./PointManager.js"` call sites keep working, while modules
//that need only the config can import ./Config.js directly without booting the bot as a side effect.
//Re-exporting an imported binding carries both its type and value meaning.
import {config} from "./Config.js";

export {config};
//All four additions are non-privileged, so no Developer Portal change is needed. GuildModeration carries
//GuildAuditLogEntryCreate, without which the planned antinuke cannot attribute a destructive action to anyone.
export const client = new Client({
	intents: [
		GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages,
		GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessageReactions,
		GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildWebhooks, GatewayIntentBits.GuildExpressions,
		GatewayIntentBits.GuildInvites
	]
});

//Re-exported for the existing `import {PointCommand} from "../PointManager.js"` call sites in commands/.
//New code should import from ./util/CommandInterface.js directly - it has no runtime dependencies, so it does
//not drag the whole bot in.
export type {AnyCommand, CommandBase, GenericCommand, PointCommand, ResponseMode} from "./util/CommandInterface.js";

const commandRegistry = new Collection<string, AnyCommand>();
const commandIdTable: { [key: string]: string } = {};

client.once(Events.ClientReady, async () => {
	await registerCommands();
	await refreshSlashCommands();
	//Last, so every handler and sweep registered at import time is in place before the first tick.
	startScheduler();
});

//The claim buttons predate the component router and their ids are baked into messages already sitting in
//people's channels, so they keep raw-string matching rather than being renamed out from under them.
registerLegacyComponent("claim_win_feed", handleFeedInteraction);
registerLegacyComponent("claim_win_channel", handleChannelInteraction);

client.on(Events.InteractionCreate, async interaction => {
	if (interaction.isContextMenuCommand()) {
		if (!(interaction.member instanceof GuildMember)) return;
		const context = getUser(interaction.member, interaction);
		if (!(context instanceof BotUserContext)) return;
		if (interaction.commandType === ApplicationCommandType.User) {
			let id = interaction.targetId;
			if (!id) return;
			await showProfileEmbed(context, id, 0, true);
		} else if (interaction.commandType === ApplicationCommandType.Message) {
			let id = interaction.targetId;
			if (!id) return;
			let message = await interaction.channel?.messages.fetch(id);
			if (!message) return;
			await showProfileEmbed(context, message.author.id, 0, true);
		}
		return;
	}
	await handleComponentInteraction(interaction).catch(console.error);
	if (!interaction.isChatInputCommand() || !(interaction.member instanceof GuildMember)) return;
	try {
		const context = getUser(interaction.member, interaction)
		const command = commandRegistry.get(interaction.commandName);

		if (!command) {
			console.error(`Command ${interaction.commandName} not found`);
			return;
		}

		//Resolving the command and its context together, in one place, is what lets `execute` be called without
		//a cast: checking `requiresUser` narrows the union to one arm, and the instanceof check narrows the
		//context to match it.
		let run: () => Promise<void>;
		if (command.requiresUser) {
			if (!(context instanceof BotUserContext)) {
				await interaction.reply(sendUninitializedError(interaction.user));
				return;
			}
			const pointCommand: PointCommand = command;
			const pointContext: BotUserContext = context;
			run = () => pointCommand.execute(pointContext);
		} else {
			const genericCommand = command;
			run = () => genericCommand.execute(context);
		}

		try {
			await openReply(interaction, command.responseMode ?? "defer");
			await run();
			if (!interaction.replied && !interaction.deferred) {
				//Under "manual" the command owns the reply, so this is the command's bug rather than the
				//dispatcher's - and Discord shows the user nothing but "application did not respond".
				console.error(`Command ${interaction.commandName} finished without responding to the interaction`);
			}
		} catch (error) {
			console.error(error);
			await respondWithError(interaction);
		}
	} catch (e) {
		console.error(e);
	}
});

async function openReply(interaction: ChatInputCommandInteraction, mode: ResponseMode): Promise<void> {
	if (mode === "defer") await interaction.deferReply();
	else if (mode === "defer_ephemeral") await interaction.deferReply({flags: MessageFlags.Ephemeral});
	//"manual" deliberately leaves the interaction untouched: showModal() is rejected once a reply is deferred.
}

async function respondWithError(interaction: ChatInputCommandInteraction): Promise<void> {
	const message = {content: "An internal error occurred!"};
	try {
		if (interaction.deferred || interaction.replied) await interaction.editReply(message);
		else await interaction.reply({...message, flags: MessageFlags.Ephemeral});
	} catch (e) {
		//editReply throws if the interaction was never deferred, which is the normal case under "manual".
		console.error("Could not report the error to the user:", e);
	}
}

client.on(Events.MessageCreate, async message => {
	if (message.author.bot || !(message.member instanceof GuildMember)) return;
	if (message.content === "") return; //Ignore empty messages (missing indent)
	try {
		let context = getUser(message.member, message);
		if (!(context instanceof BotUserContext)) {
			if (hasDialog(message)) handleDialog(context, message.content);
			else await message.reply(sendUninitializedError(message.author));
			return;
		}

		try {
			if (await checkMessage(context, message)) return;
			await handleMessage(context, message.content)
		} catch (error) {
			console.error(error);
			await message.reply("An internal error occurred!");
		}
	} catch (e) {
		console.error(e);
	}
});

client.on(Events.GuildDelete, async guild => {
	console.log(`Left guild ${guild.name} (${guild.id})`);
	console.log(`Deleting associated data...`);
	removeServerSetting(guild.id);
	db.deleteGuild(guild.id);
});

//A deleted role must not leave fake-permission rows behind: Discord does not recycle role ids, but a stale
//row would still show up in /fakepermissions list as an unresolvable id.
client.on(Events.GuildRoleDelete, role => {
	const pruned = pruneRole(role.guild.id, role.id);
	if (pruned > 0) console.log(`Pruned ${pruned} fake permission(s) for deleted role ${role.id} in ${role.guild.id}`);
});

client.on(Events.MessageDelete, message => handleMessageDelete(message).catch(console.error));
client.on(Events.MessageUpdate, (oldMessage, newMessage) => handleMessageUpdate(oldMessage, newMessage).catch(console.error));
client.on(Events.GuildMemberAdd, member => handleMemberAdd(member).catch(console.error));
client.on(Events.GuildMemberRemove, member => handleMemberRemove(member).catch(console.error));
client.on(Events.MessageReactionAdd, (reaction, user) => handleReactionAdd(reaction, user).catch(console.error));
client.on(Events.MessageReactionRemove, (reaction, user) => handleReactionRemove(reaction, user).catch(console.error));

/**
 * Loads every module in commands/ rather than naming them one by one. With 38 commands already and a long
 * feature list ahead, "wrote the file, forgot to add it to the list" is a mistake waiting to happen - and its
 * symptom is a command that simply does not exist, with nothing in the log to say why.
 *
 * Resolved from import.meta.url, not cwd: the bot is launched as `cd build && node PointManager.js`, but
 * nothing enforces that.
 */
async function registerCommands() {
	const directory = join(dirname(fileURLToPath(import.meta.url)), "commands");
	const files = readdirSync(directory).filter(file => file.endsWith(".js")).sort();
	const failed: string[] = [];
	for (const file of files) {
		try {
			const module = await import(`./commands/${file}`);
			const command = module.default as AnyCommand | undefined;
			if (!command || typeof command.execute !== "function" || !command.slashData?.name) {
				throw new Error("module does not default-export a command");
			}
			const existing = commandRegistry.get(command.slashData.name);
			//Two files claiming one name means whichever sorts later wins silently, and the other's code is
			//simply unreachable.
			if (existing) throw new Error(`duplicate command name "${command.slashData.name}"`);
			commandRegistry.set(command.slashData.name, command);
		} catch (e) {
			failed.push(file);
			console.error(`Failed to load command ${file}:`, e);
		}
	}
	console.log(`Loaded ${commandRegistry.size} commands from ${files.length} files`);
	//Loud, because refreshSlashCommands PUTs the full set: a command that failed to load is about to be
	//deleted from Discord entirely.
	if (failed.length > 0) console.error(`${failed.length} command file(s) did not load and will be unregistered: ${failed.join(", ")}`);
}

async function refreshSlashCommands() {
	if (!client.user) return;
	const rest = new REST({version: '10'}).setToken(config.token);
	const commands = [];
	for (const command of commandRegistry.values()) {
		commands.push(command.slashData.toJSON());
	}
	commands.push(new ContextMenuCommandBuilder()
		.setName("View Profile")
		.setType(ApplicationCommandType.User)
		.setDMPermission(false));
	commands.push(new ContextMenuCommandBuilder()
		.setName("View Profile")
		.setType(ApplicationCommandType.Message)
		.setDMPermission(false));
	//rest.put is typed as returning unknown, so the response shape has to be named. Asserting the documented
	//REST result type is narrower than the `// @ts-ignore` this replaces, which also hid any mistake in the
	//loop body below.
	const registered = await rest.put(Routes.applicationCommands(client.user.id), {body: commands}) as RESTPutAPIApplicationCommandsResult;
	for (const command of registered) {
		commandIdTable[command.name] = command.id;
	}
	console.log(`Registered ${commands.length} commands`);
}

export function getCommandId(name: string): string {
	return commandIdTable[name] || "0";
}

export function logAction(context: BotUserContext, action: string, color: ColorResolvable) {
	const channel = context.guild.channels.cache.get(context.getSettings().log_channel_id);
	if (!(channel instanceof TextChannel)) return;
	channel.send({
		embeds: [
			new EmbedBuilder().setAuthor({name: context.user.tag, iconURL: context.user.displayAvatarURL()})
				.setDescription(action).setColor(color).setTimestamp().toJSON()
		]
	}).catch(console.error);
}

export function logModAction(context: BotUserContext, action: string, color: ColorResolvable) {
	const channel = getModLogChannel(context);
	if (!channel) return;
	channel.send({
		embeds: [
			new EmbedBuilder().setAuthor({name: context.user.tag, iconURL: context.user.displayAvatarURL()})
				.setDescription(action).setColor(color).setTimestamp().toJSON()
		]
	}).catch(console.error);
}

client.login(config.token).then(() => console.log("Authenticated to Discord API!"));

import "./util/APIServer.js";
import "./util/WebSocketServer.js";
import "./util/ClashScheduler.js";

export {db, rewards};