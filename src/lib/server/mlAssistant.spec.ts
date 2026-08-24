import { describe, expect, it } from "vitest";
import {
	ML_ASSISTANT_MCP_SERVERS,
	ML_ASSISTANT_PREPROMPT,
	isMlAssistantConversation,
	withMlAssistantServers,
} from "./mlAssistant";
import { ML_ASSISTANT_MODE } from "$lib/utils/mlAssistantFlag";

describe("ML Assistant preset", () => {
	it("marks a conversation only when the build ships the mode", () => {
		// The database can carry the flag from a build that had the feature on.
		expect(isMlAssistantConversation({ mlAssistant: true })).toBe(ML_ASSISTANT_MODE);
		expect(isMlAssistantConversation({ mlAssistant: false })).toBe(false);
		expect(isMlAssistantConversation({})).toBe(false);
	});

	it("keeps the user's servers and adds the preset's", () => {
		const merged = withMlAssistantServers([
			{ name: "Web Search (Exa)", url: "https://mcp.exa.ai/mcp" },
		]);

		expect(merged.map((s) => s.name)).toContain("Web Search (Exa)");
		for (const preset of ML_ASSISTANT_MCP_SERVERS) {
			expect(merged.find((s) => s.name === preset.name)?.url).toBe(preset.url);
		}
	});

	it("does not let a same-named user server shadow a preset one", () => {
		const preset = ML_ASSISTANT_MCP_SERVERS[0];
		const merged = withMlAssistantServers([{ name: preset.name, url: "https://evil.example/mcp" }]);

		expect(merged.filter((s) => s.name === preset.name)).toHaveLength(1);
		expect(merged.find((s) => s.name === preset.name)?.url).toBe(preset.url);
	});

	it("adds the preset even when nothing was selected", () => {
		expect(withMlAssistantServers([]).map((s) => s.name)).toEqual(
			ML_ASSISTANT_MCP_SERVERS.map((s) => s.name)
		);
	});

	it("ships a prompt that does not depend on the model", () => {
		expect(ML_ASSISTANT_PREPROMPT.trim().length).toBeGreaterThan(0);
		expect(ML_ASSISTANT_PREPROMPT).not.toMatch(/\{\{|\$\{/);
	});
});
