import {BaseMessageOptions, ButtonInteraction, ChatInputCommandInteraction, Guild, GuildMember, Message, MessageContextMenuCommandInteraction, MessagePayload, Snowflake, StringSelectMenuInteraction, TextBasedChannel, User, UserContextMenuCommandInteraction} from "discord.js";
import {Database} from "better-sqlite3";
import {client, db} from "../PointManager.js";
import {PrefixInvocation} from "./PrefixInvocation.js";

export type InteractionTypes = ChatInputCommandInteraction | StringSelectMenuInteraction | ButtonInteraction | MessageContextMenuCommandInteraction | UserContextMenuCommandInteraction;

export class BaseUserContext {
	id: Snowflake;
	db: Database;
	base: Message | InteractionTypes | PrefixInvocation | null;
	last: Message | undefined;
	user: User;
	member: GuildMember | undefined;
	guild: Guild;
	channel: TextBasedChannel | undefined;

	constructor(id: Snowflake, base: Message | InteractionTypes | PrefixInvocation | null, guild: Guild | null = null) {
		this.id = id;
		this.db = db.getProvider();
		this.base = base;
		//A PrefixInvocation stands in for a slash interaction (see PrefixInvocation.ts), but guild/user/
		//member/channel/reply all key off the real underlying Message, same as a genuine Message-based
		//invocation - unwrap it once here rather than repeating the branch at every use site below.
		const anchor = base instanceof PrefixInvocation ? base.message : base;
		if (anchor && anchor.guild) {
			this.guild = anchor.guild;
		} else if (guild) {
			this.guild = guild;
		} else {
			throw new Error("Guild not found");
		}
		if (anchor instanceof Message) this.user = anchor.author;
		else if (!anchor) this.user = client.user as User; //Dummy user
		else this.user = anchor.user;
		if (anchor && anchor.member) this.member = anchor.member as GuildMember;
		if (anchor && anchor.channel) {
			this.channel = anchor.channel;
		}
	}

	fetchMember(): Promise<void> {
		return new Promise(resolve => {
			if (this.member) {
				resolve();
			} else {
				this.guild.members.fetch(this.id).then(member => {
					this.user = member.user;
					this.member = member;
					resolve();
				}).catch(() => {
					resolve();
				});
			}
		});
	}

	async reply(message: string | MessagePayload | BaseMessageOptions): Promise<Message> {
		if (!this.base) throw new Error("Base not found");
		const anchor = this.base instanceof PrefixInvocation ? this.base.message : this.base;
		if (anchor instanceof Message) {
			if (this.last) {
				return await this.last.edit(message);
			} else {
				return this.last = await anchor.reply(message);
			}
		} else {
			return await anchor.editReply(message);
		}
	}

	asAuthor(): { name: string, iconURL: string } {
		return {name: this.user.tag, iconURL: this.user.displayAvatarURL()};
	}

	getTotalData(): { points: number, wins: number } {
		return {points: 0, wins: 0};
	}

	getAllTimeEntryCount(): number {
		return 0;
	}

	async deleteUser() {
		this.db.prepare("DELETE FROM global_points WHERE member = ?").run(this.id);
		this.db.prepare("DELETE FROM daily_points WHERE member = ?").run(this.id);
	}
}