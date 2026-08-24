import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/server/config", () => ({ config: { GITHUB_TOKEN: "ghp_test_token" } }));

import { config } from "$lib/server/config";
import { githubJson, githubRequest, resetGithubCache } from "./client";
import { installGithubFetch, type GithubFetchMock, type Responder } from "./__fixtures__/mockFetch";

let mock: GithubFetchMock | undefined;
const install = (responder: Responder) => {
	mock = installGithubFetch(responder);
	return mock;
};

const setToken = (value: string) => {
	(config as unknown as { GITHUB_TOKEN: string }).GITHUB_TOKEN = value;
};

beforeEach(() => {
	resetGithubCache();
	setToken("ghp_test_token");
});
afterEach(() => {
	mock?.restore();
	mock = undefined;
	vi.useRealTimers();
	setToken("ghp_test_token");
});

describe("githubRequest auth", () => {
	it("sends the documented headers", async () => {
		const recorder = install(() => ({ json: { ok: true } }));
		await githubRequest("/repos/huggingface/trl");

		expect(recorder.requests[0].headers).toMatchObject({
			accept: "application/vnd.github+json",
			"x-github-api-version": "2022-11-28",
			authorization: "Bearer ghp_test_token",
		});
	});

	it("refuses to fall back to unauthenticated reads", async () => {
		// 60 requests an hour will not carry a conversation, so a missing token is a
		// configuration error to report, not a mode to degrade into.
		const recorder = install(() => ({ json: {} }));
		setToken("");
		const result = await githubRequest("/repos/huggingface/trl");

		expect(result.ok).toBe(false);
		expect(recorder.requests).toHaveLength(0);
		if (!result.ok) expect(result.message).toContain("GITHUB_TOKEN");
	});
});

describe("githubRequest caching", () => {
	it("serves a repeat read from cache without a request", async () => {
		const recorder = install(() => ({ json: { default_branch: "main" } }));
		await githubRequest("/repos/huggingface/trl");
		await githubRequest("/repos/huggingface/trl");

		expect(recorder.requests).toHaveLength(1);
	});

	it("keys the cache by media type, so a raw read is not served a JSON body", async () => {
		const recorder = install(({ headers }) =>
			headers.accept === "application/vnd.github.raw"
				? { text: "raw body" }
				: { json: { encoding: "base64" } }
		);
		await githubRequest("/repos/huggingface/trl/contents/x.py");
		const raw = await githubRequest("/repos/huggingface/trl/contents/x.py", {
			accept: "application/vnd.github.raw",
		});

		expect(recorder.requests).toHaveLength(2);
		expect(raw.ok && raw.body).toBe("raw body");
	});

	it("revalidates with If-None-Match once the entry lapses, and reuses the body on 304", async () => {
		// A 304 costs a round trip but no rate-limit budget, which is the whole point
		// of keeping the etag rather than just expiring the entry.
		vi.useFakeTimers({ toFake: ["Date"] });
		const recorder = install(({ headers }) =>
			headers["if-none-match"] === '"v1"'
				? { status: 304 }
				: { json: { default_branch: "main" }, headers: { etag: '"v1"' } }
		);

		const first = await githubRequest("/repos/huggingface/trl");
		vi.setSystemTime(Date.now() + 10 * 60_000);
		const second = await githubRequest("/repos/huggingface/trl");

		expect(recorder.requests).toHaveLength(2);
		expect(recorder.requests[1].headers["if-none-match"]).toBe('"v1"');
		expect(second).toEqual(first);
	});

	it("does not cache when the caller opts out", async () => {
		const recorder = install(() => ({ json: { items: [] } }));
		await githubRequest("/search/repositories?q=x", { cache: false });
		await githubRequest("/search/repositories?q=x", { cache: false });

		expect(recorder.requests).toHaveLength(2);
	});

	it("drops everything cached under a token that has been rotated", async () => {
		const recorder = install(({ headers }) => ({ json: { seen: headers.authorization } }));
		await githubRequest("/repos/huggingface/trl");
		setToken("ghp_rotated");
		const after = await githubRequest("/repos/huggingface/trl");

		expect(recorder.requests).toHaveLength(2);
		expect(after.ok && after.body).toContain("ghp_rotated");
	});
});

describe("githubRequest failures", () => {
	it("reports a rate limit with the reset time", async () => {
		const reset = Math.floor(Date.now() / 1000) + 12 * 60;
		install(() => ({
			status: 403,
			json: { message: "API rate limit exceeded" },
			headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
		}));
		const result = await githubRequest("/repos/huggingface/trl");

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toContain("rate limit");
			expect(result.message).toMatch(/about 12 minutes/);
		}
	});

	it("treats a 403 that is not a rate limit as an ordinary error", async () => {
		install(() => ({ status: 403, json: { message: "Resource not accessible" } }));
		const result = await githubRequest("/repos/huggingface/trl");

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toContain("status 403");
			expect(result.message).toContain("Resource not accessible");
		}
	});

	it("names an expired token", async () => {
		install(() => ({ status: 401, json: { message: "Bad credentials" } }));
		const result = await githubRequest("/repos/huggingface/trl");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain("expired or revoked");
	});

	it("reports a transport failure as text, not a rejection", async () => {
		const previous = globalThis.fetch;
		globalThis.fetch = (async () => {
			throw new Error("getaddrinfo ENOTFOUND api.github.com");
		}) as typeof fetch;
		try {
			const result = await githubRequest("/repos/huggingface/trl");
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.message).toContain("Could not reach the GitHub API");
		} finally {
			globalThis.fetch = previous;
		}
	});

	it("reports a body that is not JSON without throwing", async () => {
		install(() => ({ text: "<html>maintenance</html>" }));
		const result = await githubJson("/repos/huggingface/trl");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain("malformed");
	});
});
