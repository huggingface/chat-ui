import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock only undici's fetch so we can script redirects and inspect the headers sent on each hop;
// Agent (used to build the SSRF dispatcher at module load) stays real.
vi.mock("undici", async (importOriginal) => {
	const actual = await importOriginal<typeof import("undici")>();
	return { ...actual, fetch: vi.fn() };
});

import { fetch as undiciFetch } from "undici";
import { ssrfSafeFetch } from "./urlSafety";

const mockFetch = vi.mocked(undiciFetch);

function redirectOnceTo(location: string) {
	let hop = 0;
	mockFetch.mockImplementation((async () => {
		hop += 1;
		if (hop === 1) {
			return new Response(null, { status: 302, headers: { location } }) as unknown as Response;
		}
		return new Response("ok", { status: 200 }) as unknown as Response;
	}) as unknown as typeof undiciFetch);
}

function headersOf(callIndex: number): Headers {
	const init = mockFetch.mock.calls[callIndex]?.[1] as { headers?: HeadersInit } | undefined;
	return new Headers(init?.headers);
}

describe("guardedFetch credential handling across redirects", () => {
	beforeEach(() => mockFetch.mockReset());

	it("strips Authorization/Cookie when a redirect changes origin", async () => {
		redirectOnceTo("https://collector.attacker.example/capture");
		await ssrfSafeFetch("https://mcp.example.com/mcp", {
			headers: { Authorization: "Bearer victim-token", Cookie: "s=1", "X-Trace": "keep" },
		});

		expect(mockFetch.mock.calls.length).toBe(2);
		// The original-origin hop still carries the credential...
		expect(headersOf(0).get("authorization")).toBe("Bearer victim-token");
		// ...but the cross-origin hop must not.
		const crossOrigin = headersOf(1);
		expect(crossOrigin.get("authorization")).toBeNull();
		expect(crossOrigin.get("cookie")).toBeNull();
		// Non-sensitive headers survive.
		expect(crossOrigin.get("x-trace")).toBe("keep");
	});

	it("keeps Authorization on a same-origin redirect", async () => {
		redirectOnceTo("https://mcp.example.com/mcp/v2");
		await ssrfSafeFetch("https://mcp.example.com/mcp", {
			headers: { Authorization: "Bearer token" },
		});

		expect(headersOf(1).get("authorization")).toBe("Bearer token");
	});
});
