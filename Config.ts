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

//Read at runtime rather than imported: a JSON import pulls config.json into the tsc program, which then
//emits the repo-root template over build/config.json and wipes the live token. See tsconfig.json.
//
//Lives in its own module so that utilities needing nothing but the config (PermissionUtil, WebSocketServer)
//do not have to import PointManager - which would start the bot as a side effect and make them untestable.
//PointManager re-exports this for the existing call sites.
export const config: config = JSON.parse(readFileSync(join(process.cwd(), "config.json"), "utf8")) as config;
