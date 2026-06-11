/**
 * Unit tests for mcpServers store — focused on initWithServers.
 *
 * The test environment runs in Node (browser === false), so:
 *   - localStorage helpers (loadCustomServers, loadDisabledBaseIds, etc.) return
 *     empty collections — isolating the tests to pure store-state behavior.
 *   - The module-level `if (browser) { refreshMcpServers(); }` does NOT run,
 *     so no real fetch is attempted during import.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import type { MCPServer } from "$lib/types/Tool";

// These imports resolve after vi.mock hoisting, so the mock is active.
import {
	allMcpServers,
	mcpServersLoaded,
	selectedServerIds,
	enabledServers,
	initWithServers,
} from "./mcpServers";

// --- helpers ---

function makeServer(name: string): MCPServer {
	return {
		id: `base-${name}`,
		name,
		url: `https://mcp.example.com/${name}`,
		type: "base",
		isLocked: false,
		status: undefined,
	};
}

/** Reset all stores to their initial state before each test. */
function resetStores() {
	allMcpServers.set([]);
	mcpServersLoaded.set(false);
	selectedServerIds.set(new Set());
}

beforeEach(resetStores);

// ─── tests ───────────────────────────────────────────────────────────────────

describe("initWithServers", () => {
	it("sets mcpServersLoaded to true with an empty list", () => {
		expect(get(mcpServersLoaded)).toBe(false);

		initWithServers([]);

		expect(get(mcpServersLoaded)).toBe(true);
		expect(get(allMcpServers)).toEqual([]);
		expect(get(selectedServerIds).size).toBe(0);
	});

	it("populates allMcpServers with the provided base servers", () => {
		const servers = [makeServer("search"), makeServer("files")];

		initWithServers(servers);

		expect(get(allMcpServers)).toEqual(servers);
	});

	it("adds all base server IDs to selectedServerIds (none disabled in this env)", () => {
		const servers = [makeServer("search"), makeServer("files")];

		initWithServers(servers);

		const selected = get(selectedServerIds);
		expect(selected.has("base-search")).toBe(true);
		expect(selected.has("base-files")).toBe(true);
		expect(selected.size).toBe(2);
	});

	it("enabledServers derived store reflects the base servers after init", () => {
		const servers = [makeServer("search"), makeServer("files")];

		initWithServers(servers);

		expect(get(enabledServers)).toEqual(servers);
	});

	it("is idempotent — second call with new data wins cleanly", () => {
		const first = [makeServer("search")];
		const second = [makeServer("files"), makeServer("code")];

		initWithServers(first);
		expect(get(allMcpServers)).toEqual(first);
		expect(get(mcpServersLoaded)).toBe(true);

		initWithServers(second);
		expect(get(allMcpServers)).toEqual(second);
		expect(get(mcpServersLoaded)).toBe(true);
		const selected = get(selectedServerIds);
		expect(selected.has("base-files")).toBe(true);
		expect(selected.has("base-code")).toBe(true);
		expect(selected.has("base-search")).toBe(false);
	});

	it("mcpServersLoaded transitions false → true exactly once per call", () => {
		const transitions: boolean[] = [];
		const unsub = mcpServersLoaded.subscribe((v) => transitions.push(v));

		initWithServers([makeServer("search")]);

		unsub();
		// Initial subscribe fires with false, then the set(true) fires.
		expect(transitions).toEqual([false, true]);
	});

	it("does not include unrecognised IDs already in selectedServerIds", () => {
		// Pre-seed a stale ID that has no corresponding server any more.
		selectedServerIds.set(new Set(["base-old-gone"]));

		initWithServers([makeServer("search")]);

		const selected = get(selectedServerIds);
		expect(selected.has("base-old-gone")).toBe(false);
		expect(selected.has("base-search")).toBe(true);
	});
});
