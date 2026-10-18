import {readFileSync} from "fs";
import {join} from "path";

export interface config {
	token: string,
	unbelieva_app_id: string,
	unbelieva_bot_token: string,
	endpoint_self: string,
	btt_api_url: string,
	wss_secret: string,
	bot_owner: string
}

//Each field's environment variable, matching feeder.cjs's existing WSS_SECRET convention and Wispbyte's own
//docs (which give BOT_TOKEN as the example for a Discord bot token). Checked before config.json so a host
//that sets these never needs the real token sitting in an uploaded/cloned file at all.
const ENV_VARS: Record<keyof config, string> = {
	token: "BOT_TOKEN",
	unbelieva_app_id: "UNBELIEVA_APP_ID",
	unbelieva_bot_token: "UNBELIEVA_BOT_TOKEN",
	endpoint_self: "ENDPOINT_SELF",
	btt_api_url: "BTT_API_URL",
	wss_secret: "WSS_SECRET",
	bot_owner: "BOT_OWNER"
};

//Read at runtime rather than imported: a JSON import pulls config.json into the tsc program, which then
//emits the repo-root template over build/config.json and wipes the live token. See tsconfig.json.
//
//Lives in its own module so that utilities needing nothing but the config (PermissionUtil, WebSocketServer)
//do not have to import PointManager - which would start the bot as a side effect and make them untestable.
//PointManager re-exports this for the existing call sites.
function loadConfig(): config {
	let fromFile: Partial<config> = {};
	try {
		fromFile = JSON.parse(readFileSync(join(process.cwd(), "config.json"), "utf8"));
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
		//Missing entirely is fine as long as every field below comes from an environment variable instead -
		//the whole point on a host like Wispbyte, where config.json should never exist with a real token in it.
	}

	const result = {} as config;
	const missing: string[] = [];
	for (const key of Object.keys(ENV_VARS) as (keyof config)[]) {
		const envVar = ENV_VARS[key];
		const value = process.env[envVar] ?? fromFile[key];
		if (value === undefined) {
			missing.push(`${key} (set ${envVar} or add it to config.json)`);
			continue;
		}
		result[key] = value;
	}
	if (missing.length > 0) {
		throw new Error(`Missing config value(s):\n- ${missing.join("\n- ")}`);
	}
	return result;
}

export const config: config = loadConfig();
