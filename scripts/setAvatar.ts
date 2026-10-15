import {Client, GatewayIntentBits} from "discord.js";
import * as fs from "fs";

function localPath(relative: string): string {
	return new URL(relative, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
}

//Read at runtime rather than imported: a JSON import pulls config.json into the tsc program, which then
//emits the repo-root template over build/config.json and wipes the live token
const rawSettings = JSON.parse(fs.readFileSync(localPath("../config.json"), "utf8"));

const client = new Client({intents: [GatewayIntentBits.Guilds]});

client.once("ready", async () => {
	await client.user!.setAvatar(fs.readFileSync(localPath("./icon.png")));
	console.log("Avatar updated.");
	process.exit(0);
});

client.login((rawSettings as { token: string }).token);
