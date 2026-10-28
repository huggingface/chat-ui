import { describe, expect, it } from "vitest";
import {
	BTW_COMMAND,
	leadingSlashCommand,
	matchingSlashCommands,
	slashCommandQuery,
	type SlashCommand,
} from "./slashCommands";

const commands: SlashCommand[] = [BTW_COMMAND, { name: "bench", description: "Run a benchmark" }];

describe("slashCommandQuery", () => {
	it("reads the partial name while typing the first word", () => {
		expect(slashCommandQuery("/", 1)).toBe("");
		expect(slashCommandQuery("/bt", 3)).toBe("bt");
		expect(slashCommandQuery("/BT", 3)).toBe("BT");
		expect(slashCommandQuery("/btw hello", 2)).toBe("b");
	});

	it("is undefined once past the first word or away from index 0", () => {
		expect(slashCommandQuery("/btw ", 5)).toBeUndefined();
		expect(slashCommandQuery(" /btw", 5)).toBeUndefined();
		expect(slashCommandQuery("hi /b", 5)).toBeUndefined();
		expect(slashCommandQuery("/b1", 3)).toBeUndefined();
		expect(slashCommandQuery("/btw", 0)).toBeUndefined();
		expect(slashCommandQuery("", 0)).toBeUndefined();
	});
});

describe("matchingSlashCommands", () => {
	it("filters by prefix, case-insensitively", () => {
		expect(matchingSlashCommands("", commands)).toEqual(commands);
		expect(matchingSlashCommands("b", commands)).toEqual(commands);
		expect(matchingSlashCommands("BT", commands)).toEqual([BTW_COMMAND]);
		expect(matchingSlashCommands("x", commands)).toEqual([]);
		expect(matchingSlashCommands("btwx", commands)).toEqual([]);
	});
});

describe("leadingSlashCommand", () => {
	it("finds a known command at index 0 before whitespace or the end", () => {
		expect(leadingSlashCommand("/btw", commands)).toEqual({ start: 0, end: 4, name: "btw" });
		expect(leadingSlashCommand("/BTW hello", commands)).toEqual({
			start: 0,
			end: 4,
			name: "btw",
		});
		expect(leadingSlashCommand("/bench\nnow", commands)?.end).toBe(6);
	});

	it("ignores unknown, partial, indented and mid-text commands", () => {
		expect(leadingSlashCommand("/bt hello", commands)).toBeUndefined();
		expect(leadingSlashCommand("/btwx", commands)).toBeUndefined();
		expect(leadingSlashCommand(" /btw hello", commands)).toBeUndefined();
		expect(leadingSlashCommand("so /btw hello", commands)).toBeUndefined();
		expect(leadingSlashCommand("/btw hello", [])).toBeUndefined();
	});
});
