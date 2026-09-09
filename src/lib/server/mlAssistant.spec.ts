import { describe, expect, it, vi } from "vitest";

const mockedServers = vi.hoisted(() => ({
	value: [] as Array<{ name: string; url: string; headers?: Record<string, string> }>,
}));
vi.mock("./mcp/registry", () => ({ getMcpServers: () => mockedServers.value }));

import {
	ML_ASSISTANT_HF_MCP_URL,
	ML_ASSISTANT_MCP_SERVERS,
	isMlAssistantConversation,
	pinnedHubToken,
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

	it("yields to an explicitly-authed entry that still points at the Hub MCP", () => {
		// OAuth deployments whose app cannot request the privileged scopes pin a
		// token on the env entry instead; the preset must not strip it. It wins
		// for its credential only: the mode's tool set still comes from the
		// intern bouquet.
		const preset = ML_ASSISTANT_MCP_SERVERS[0];
		const pinned = {
			name: preset.name,
			url: "https://hf.co/mcp",
			headers: { Authorization: "Bearer hf_test" },
		};
		const merged = withMlAssistantServers([pinned]);

		expect(merged.filter((s) => s.name === preset.name)).toHaveLength(1);
		expect(merged.find((s) => s.name === preset.name)).toEqual({
			...pinned,
			url: "https://hf.co/mcp?bouquet=intern",
		});
	});

	it("keeps a bouquet the operator chose on a pinned entry", () => {
		const preset = ML_ASSISTANT_MCP_SERVERS[0];
		const pinned = {
			name: preset.name,
			url: "https://hf.co/mcp?bouquet=all",
			headers: { Authorization: "Bearer hf_test" },
		};

		expect(withMlAssistantServers([pinned]).find((s) => s.name === preset.name)).toEqual(pinned);
	});

	it("still refuses an authed entry pointing anywhere else", () => {
		const preset = ML_ASSISTANT_MCP_SERVERS[0];
		const merged = withMlAssistantServers([
			{
				name: preset.name,
				url: "https://evil.example/mcp",
				headers: { Authorization: "Bearer hf_test" },
			},
		]);

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
		expect(isStrictHfMcpLogin(ML_ASSISTANT_HF_MCP_URL)).toBe(true);
		expect(ML_ASSISTANT_MCP_SERVERS.map((server) => server.url)).toContain(ML_ASSISTANT_HF_MCP_URL);
	});

	it("runs the Hub server on the intern bouquet", () => {
		// The bouquet is the mode's tool set — the Hub server resolves it per
		// request, so the mode picks up preset changes without a deploy here.
		expect(new URL(ML_ASSISTANT_HF_MCP_URL).searchParams.get("bouquet")).toBe("intern");
	});

	it("adds the preset even when nothing was selected", () => {
		expect(withMlAssistantServers([]).map((s) => s.name)).toEqual(
			ML_ASSISTANT_MCP_SERVERS.map((s) => s.name)
		);
	});
});

describe("pinnedHubToken", () => {
	it("reads the Bearer token off an operator-pinned Hub entry", () => {
		mockedServers.value = [
			{ name: "Other", url: "https://other.example/mcp", headers: { Authorization: "Bearer no" } },
			{
				name: "Hugging Face",
				url: "https://hf.co/mcp",
				headers: { authorization: "Bearer hf_pinned" },
			},
		];
		expect(pinnedHubToken()).toBe("hf_pinned");
	});

	it("returns nothing without a pinned Hub credential", () => {
		mockedServers.value = [{ name: "Hugging Face", url: "https://hf.co/mcp" }];
		expect(pinnedHubToken()).toBeUndefined();
		mockedServers.value = [
			// Not a Bearer header: unusable for the REST lookup, so not extracted.
			{ name: "Hugging Face", url: "https://hf.co/mcp", headers: { Authorization: "Basic abc" } },
		];
		expect(pinnedHubToken()).toBeUndefined();
	});
});
