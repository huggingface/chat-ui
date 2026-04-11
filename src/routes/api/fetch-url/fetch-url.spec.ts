import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The config module is the source that `+server.ts` reads FETCH_PROXY_URL /
// FETCH_PROXY_SECRET from. Mock it up-front so the module under test sees the
// values we want. Use getters so individual tests can toggle them by mutating
// `proxyConfig` between calls.
const proxyConfig: { FETCH_PROXY_URL: string; FETCH_PROXY_SECRET: string } = {
	FETCH_PROXY_URL: "",
	FETCH_PROXY_SECRET: "",
};

vi.mock("$lib/server/config", () => ({
	config: new Proxy(
		{},
		{
			get(_target, prop: string) {
				if (prop === "FETCH_PROXY_URL") return proxyConfig.FETCH_PROXY_URL;
				if (prop === "FETCH_PROXY_SECRET") return proxyConfig.FETCH_PROXY_SECRET;
				return "";
			},
		}
	),
}));

vi.mock("$lib/server/logger.js", () => ({
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}));

// Stub the SSRF-safe fetch to allow the direct fetch path tests. Each test
// overrides the behaviour as needed.
const ssrfSafeFetchMock = vi.fn();
vi.mock("$lib/server/urlSafety", () => ({
	isValidUrl: (u: string) => u.startsWith("https://"),
	ssrfSafeFetch: (url: string, init?: RequestInit) => ssrfSafeFetchMock(url, init),
}));

// Import the route module AFTER mocks are set up.
const { GET } = await import("./+server");

function mockEvent(targetUrl: string) {
	const url = new URL(
		`https://chat.example.com/api/fetch-url?url=${encodeURIComponent(targetUrl)}`
	);
	return { url } as unknown as Parameters<typeof GET>[0];
}

describe("GET /api/fetch-url", () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let fetchSpy: any;

	beforeEach(() => {
		proxyConfig.FETCH_PROXY_URL = "";
		proxyConfig.FETCH_PROXY_SECRET = "";
		ssrfSafeFetchMock.mockReset();
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	describe("direct fetch path (FETCH_PROXY_URL not set)", () => {
		it("uses ssrfSafeFetch and returns the body with forwarded content-type", async () => {
			ssrfSafeFetchMock.mockResolvedValueOnce(
				new Response("hello", {
					status: 200,
					headers: { "content-type": "text/markdown" },
				})
			);

			const res = await GET(mockEvent("https://example.com/readme.md"));

			expect(res.status).toBe(200);
			expect(res.headers.get("x-forwarded-content-type")).toBe("text/markdown");
			expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
			expect(await res.text()).toBe("hello");
			expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1);
			expect(fetchSpy).not.toHaveBeenCalled();
		});
	});

	describe("proxy delegation path (FETCH_PROXY_URL set)", () => {
		beforeEach(() => {
			proxyConfig.FETCH_PROXY_URL = "https://proxy.example.workers.dev";
			proxyConfig.FETCH_PROXY_SECRET = "super-secret";
		});

		it("calls the proxy with the secret header and maps response headers", async () => {
			fetchSpy.mockResolvedValueOnce(
				new Response("proxied body", {
					status: 200,
					headers: {
						"content-type": "application/octet-stream",
						"x-original-content-type": "image/png",
						"x-original-status": "200",
						"content-disposition": 'attachment; filename="cat.png"',
					},
				})
			);

			const res = await GET(mockEvent("https://example.com/cat.png"));

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			const firstCall = fetchSpy.mock.calls[0];
			expect(firstCall).toBeDefined();
			const [calledUrl, init] = firstCall as [unknown, RequestInit];
			expect(String(calledUrl)).toBe(
				"https://proxy.example.workers.dev/fetch?url=https%3A%2F%2Fexample.com%2Fcat.png"
			);
			expect((init as RequestInit).headers).toMatchObject({
				"X-Proxy-Secret": "super-secret",
			});

			expect(res.status).toBe(200);
			expect(res.headers.get("x-forwarded-content-type")).toBe("image/png");
			expect(res.headers.get("content-disposition")).toBe('attachment; filename="cat.png"');
			expect(await res.text()).toBe("proxied body");
			// Make sure we didn't fall through to the direct fetch path.
			expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
		});

		it("bubbles up proxy errors as HTTP errors", async () => {
			fetchSpy.mockResolvedValueOnce(
				new Response("File too large", {
					status: 413,
					headers: { "content-type": "text/plain" },
				})
			);

			await expect(GET(mockEvent("https://example.com/big.bin"))).rejects.toMatchObject({
				status: 413,
			});
		});

		it("returns 502 on network failure to the proxy", async () => {
			fetchSpy.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

			await expect(GET(mockEvent("https://example.com/whatever"))).rejects.toMatchObject({
				status: 502,
			});
		});

		it("rejects when FETCH_PROXY_SECRET is missing", async () => {
			proxyConfig.FETCH_PROXY_SECRET = "";

			await expect(GET(mockEvent("https://example.com/whatever"))).rejects.toMatchObject({
				status: 500,
			});
			expect(fetchSpy).not.toHaveBeenCalled();
		});
	});

	describe("input validation", () => {
		it("rejects missing url parameter", async () => {
			const url = new URL("https://chat.example.com/api/fetch-url");
			await expect(GET({ url } as unknown as Parameters<typeof GET>[0])).rejects.toMatchObject({
				status: 400,
			});
		});

		it("rejects non-https URLs before delegating", async () => {
			proxyConfig.FETCH_PROXY_URL = "https://proxy.example.workers.dev";
			proxyConfig.FETCH_PROXY_SECRET = "x";

			await expect(GET(mockEvent("http://example.com"))).rejects.toMatchObject({ status: 400 });
			expect(fetchSpy).not.toHaveBeenCalled();
		});
	});
});
