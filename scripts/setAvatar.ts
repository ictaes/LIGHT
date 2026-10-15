import {Client, GatewayIntentBits} from "discord.js";
import * as fs from "fs";
import rawSettings from "../config.json" with { type: "json" };

const client = new Client({intents: [GatewayIntentBits.Guilds]});

client.once("ready", async () => {
	const iconPath = new URL("./icon.png", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
	await client.user!.setAvatar(fs.readFileSync(iconPath));
	console.log("Avatar updated.");
	process.exit(0);
});

client.login((rawSettings as { token: string }).token);
