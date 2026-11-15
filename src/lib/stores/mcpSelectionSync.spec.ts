import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { allMcpServers, selectedServerIds, mcpServersLoaded } from "./mcpServers";
import { syncMcpSelection } from "./mcpSelectionSync";
import { error } from "./errors";

let stop: (() => void) | undefined;
const fetchMock = vi.fn();
beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("fetch", fetchMock);
	fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
	mcpServersLoaded.set(false);
	allMcpServers.set([]);
	selectedServerIds.set(new Set());
	error.set(undefined);
});
afterEach(() => {
	stop?.();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it("waits for hydration and sends only enabled servers with OAuth references", async () => {
	stop = syncMcpSelection("owner", { saved: false });
	await vi.advanceTimersByTimeAsync(500);
	expect(fetchMock).not.toHaveBeenCalled();
	allMcpServers.set([
		{
			id: "one",
			type: "custom",
			name: "One",
			url: "https://one.test/mcp",
			isLocked: false,
			oauth: { connectionId: "connection", issuer: "https://one.test", status: "authorized" },
		},
		{ id: "two", type: "custom", name: "Two", url: "https://two.test/mcp", isLocked: false },
	]);
	selectedServerIds.set(new Set(["one"]));
	mcpServersLoaded.set(true);
	await vi.advanceTimersByTimeAsync(500);
	expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
		userId: "owner",
		selectedMcpServerNames: ["One"],
		selectedMcpServers: [
			{ name: "One", url: "https://one.test/mcp", headers: [], oauthConnectionId: "connection" },
		],
	});
	selectedServerIds.set(new Set());
	await vi.advanceTimersByTimeAsync(500);
	expect(JSON.parse(fetchMock.mock.calls[1][1].body).selectedMcpServers).toEqual([]);
});

it("serializes updates and cancels pending writes on account change", async () => {
	let release: (response: Response) => void = () => {};
	fetchMock.mockImplementationOnce(
		() =>
			new Promise<Response>((resolve) => {
				release = resolve;
			})
	);
	mcpServersLoaded.set(true);
	stop = syncMcpSelection("owner", { saved: false });
	await vi.advanceTimersByTimeAsync(500);
	allMcpServers.set([
		{ id: "one", type: "custom", name: "One", url: "https://one.test/mcp", isLocked: false },
	]);
	selectedServerIds.set(new Set(["one"]));
	await vi.advanceTimersByTimeAsync(500);
	expect(fetchMock).toHaveBeenCalledTimes(1);
	stop();
	release(new Response(null, { status: 204 }));
	await vi.advanceTimersByTimeAsync(500);
	expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("reports a failed sync without exposing headers", async () => {
	fetchMock.mockResolvedValue(new Response("private-token", { status: 500 }));
	mcpServersLoaded.set(true);
	stop = syncMcpSelection("owner", { saved: false });
	await vi.advanceTimersByTimeAsync(500);
	expect(get(error)).toContain("Could not sync MCP servers");
	expect(get(error)).not.toContain("private-token");
});

it("does not let a page load replace an existing saved selection", async () => {
	allMcpServers.set([
		{ id: "base", type: "base", name: "Base", url: "https://base.test/mcp", isLocked: false },
		{ id: "one", type: "custom", name: "One", url: "https://one.test/mcp", isLocked: false },
	]);
	selectedServerIds.set(new Set(["base"]));
	mcpServersLoaded.set(true);
	stop = syncMcpSelection("owner", { saved: true });
	await vi.advanceTimersByTimeAsync(500);
	expect(fetchMock).not.toHaveBeenCalled();
	selectedServerIds.set(new Set(["base", "one"]));
	await vi.advanceTimersByTimeAsync(500);
	expect(fetchMock).toHaveBeenCalledTimes(1);
	expect(JSON.parse(fetchMock.mock.calls[0][1].body).selectedMcpServerNames).toEqual([
		"Base",
		"One",
	]);
});
