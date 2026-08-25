import { describe, expect, it } from "vitest";
import {
	ML_ASSISTANT_MCP_SERVERS,
	isMlAssistantConversation,
	withMlAssistantServers,
} from "./mlAssistant";
import { ML_ASSISTANT_MODE } from "$lib/utils/mlAssistantFlag";
import { isStrictHfMcpLogin } from "./mcp/hf";

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

	it("puts the preset's servers first", () => {
		const merged = withMlAssistantServers([
			{ name: "Web Search (Exa)", url: "https://mcp.exa.ai/mcp" },
		]);

		expect(merged.slice(0, ML_ASSISTANT_MCP_SERVERS.length).map((s) => s.name)).toEqual(
			ML_ASSISTANT_MCP_SERVERS.map((s) => s.name)
		);
	});

	it("keeps a same-named preset server in the preset's position, not the user's", () => {
		const preset = ML_ASSISTANT_MCP_SERVERS[0];
		const merged = withMlAssistantServers([
			{ name: "First", url: "https://first.example/mcp" },
			{ name: preset.name, url: "https://shadow.example/mcp" },
		]);

		expect(merged[0].name).toBe(preset.name);
		expect(merged[0].url).toBe(preset.url);
	});

	it("points at the HF endpoint that can authenticate", () => {
		// The bare https://hf.co/mcp never gets the user's token forwarded and offers
		// no login control, so the mode's Hub tools would run anonymously. It is
		// worse than a local mistake: the preset wins the name collision, so it
		// would replace the ?login entry prod and dev already configure.
		const hf = ML_ASSISTANT_MCP_SERVERS.find((server) => server.url.includes("hf.co"));
		expect(hf && isStrictHfMcpLogin(hf.url)).toBe(true);
	});

	it("adds the preset even when nothing was selected", () => {
		expect(withMlAssistantServers([]).map((s) => s.name)).toEqual(
			ML_ASSISTANT_MCP_SERVERS.map((s) => s.name)
		);
	});
});
