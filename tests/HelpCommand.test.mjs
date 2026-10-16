import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {readFileSync} from "fs";
import path from "path";
import {fileURLToPath} from "url";

//HelpCommand cannot be imported - it reaches PointManager for getCommandId. So this reads the source and
//rebuilds the sections with a stub, which is enough to check the thing that actually breaks: Discord
//rejects the whole embed if any field value exceeds 1024 characters or the embed exceeds 6000, so one
//command too many silently turns /help into "An internal error occurred".

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "commands", "HelpCommand.ts"), "utf8");

const MAX_FIELD_LENGTH = 1024;
const MAX_EMBED_LENGTH = 6000;
//A command id is a snowflake; getCommandId returns one of these or "0".
const ID_LENGTH = 19;

/** Rebuilds the rendered entries from the source, substituting a realistic id length for getCommandId. */
function sectionsFromSource() {
	const sections = [];
	//Matches `name: "X",` followed by an `entries: [...]` block.
	const sectionRe = /name:\s*"([^"]+)",\s*entries:\s*\[([\s\S]*?)\n\t\t\t\]/g;
	let match;
	while ((match = sectionRe.exec(source)) !== null) {
		const entries = [...match[2].matchAll(/`([^`]*)`/g)].map(entry =>
			entry[1].replace(/\$\{cmd\("([^"]+)"\)\}/g, (_, path) => `</${path}:${"9".repeat(ID_LENGTH)}>`));
		sections.push({name: match[1], entries});
	}
	return sections;
}

describe("help embed", () => {
	const sections = sectionsFromSource();

	it("parses every section out of the source", () => {
		//Guards the test itself: a refactor that changes the shape would otherwise make it vacuously pass.
		assert.ok(sections.length >= 6, `expected at least 6 sections, parsed ${sections.length}`);
		for (const section of sections) {
			assert.ok(section.entries.length > 0, `section "${section.name}" parsed with no entries`);
		}
	});

	it("leaves every entry short enough to live in a field on its own", () => {
		for (const section of sections) {
			for (const entry of section.entries) {
				assert.ok(entry.length < MAX_FIELD_LENGTH, `entry in "${section.name}" is ${entry.length} chars: ${entry}`);
			}
		}
	});

	it("fits inside the 6000 character embed budget once split", () => {
		const total = sections.reduce((sum, section) =>
			sum + section.name.length + section.entries.reduce((s, e) => s + e.length + 1, 0), 0);
		assert.ok(total < MAX_EMBED_LENGTH, `help embed renders to ~${total} characters, over Discord's ${MAX_EMBED_LENGTH} limit`);
	});

	it("stays under Discord's 25 field limit after splitting", () => {
		const fields = sections.reduce((count, section) => {
			let used = 0, parts = 1;
			for (const entry of section.entries) {
				if (used && used + entry.length + 1 > MAX_FIELD_LENGTH) {
					parts++;
					used = 0;
				}
				used += entry.length + 1;
			}
			return count + parts;
		}, 0);
		assert.ok(fields <= 25, `help would render ${fields} fields, over Discord's limit of 25`);
	});
});
