import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("$app/environment", () => ({ dev: false }));
vi.mock("$lib/server/database", () => ({
	collections: {
		conversations: { findOne: vi.fn(async () => ({ managedBy: { kind: "slack" } })) },
		sessions: { updateOne: vi.fn() },
	},
}));
vi.mock("$lib/server/config", () => ({
	config: { PUBLIC_ORIGIN: "https://chat.example", checkForUpdates: vi.fn() },
	ready: Promise.resolve(),
}));
const auth = vi.hoisted(() => ({ loginEnabled: false }));
vi.mock("$lib/server/auth", () => ({
	get loginEnabled() {
		return auth.loginEnabled;
	},
	authCondition: () => ({ sessionId: "test" }),
	authenticateRequest: vi.fn(async () => ({ sessionId: "test" })),
	refreshSessionCookie: vi.fn(),
	triggerOauthFlow: vi.fn(),
}));
vi.mock("$lib/server/adminToken", () => ({ adminTokenManager: { isAdmin: () => false } }));
vi.mock("$lib/server/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn() } }));

import { handleRequest } from "./handle";
import { collections } from "$lib/server/database";
import { triggerOauthFlow } from "$lib/server/auth";
beforeEach(() => {
	vi.clearAllMocks();
	auth.loginEnabled = false;
});

function event(method: string, origin: string) {
	const url = new URL("https://chat.example/api/v2/user/settings");
	return {
		url,
		route: { id: "/api/v2/user/settings" },
		locals: {},
		params: {},
		request: new Request(url, {
			method,
			headers: { origin, "content-type": "application/x-www-form-urlencoded" },
		}),
	} as Parameters<typeof handleRequest>[0]["event"];
}

describe("opaque request origins", () => {
	it("allows API reads after OAuth redirects without granting the opaque origin CORS access", async () => {
		const response = await handleRequest({
			event: event("GET", "null"),
			resolve: async () => new Response("ok"),
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://chat.example");
	});
	it.each(["null", "malformed"])(
		"rejects form posts with origin %s instead of crashing",
		async (origin) => {
			const resolve = vi.fn();
			const response = await handleRequest({ event: event("POST", origin), resolve });
			expect(response.status).toBe(403);
			expect(resolve).not.toHaveBeenCalled();
		}
	);
});

it("rejects Slack conversation mutations before the route handler runs", async () => {
	const request = event("POST", "https://chat.example");
	request.params.id = "6ad03a4c353929f19edc560f";
	request.route.id = "/conversation/[id]";
	const resolve = vi.fn();
	const response = await handleRequest({ event: request, resolve });
	expect(response.status).toBe(403);
	expect(resolve).not.toHaveBeenCalled();
});

it("validates the request origin before looking up Slack ownership", async () => {
	const request = event("POST", "https://other.example");
	request.params.id = "6ad03a4c353929f19edc560f";
	request.route.id = "/conversation/[id]";
	const response = await handleRequest({ event: request, resolve: vi.fn() });
	expect(response.status).toBe(403);
	expect(collections.conversations.findOne).not.toHaveBeenCalled();
});

it("omits oversized HTML preload headers while retaining the HTML preload tags", async () => {
	const html = '<html><head><link rel="modulepreload" href="/app.js"></head></html>';
	const response = await handleRequest({
		event: event("GET", "https://chat.example"),
		resolve: async () =>
			new Response(html, {
				headers: {
					"content-type": "text/html; charset=utf-8",
					link: Array.from({ length: 80 }, (_, i) => `</chunk-${i}.js>; rel="modulepreload"`).join(
						", "
					),
				},
			}),
	});
	expect(response.headers.has("link")).toBe(false);
	expect(await response.text()).toBe(html);
});

it.each([
	["text/html", '</app.js>; rel="modulepreload"'],
	["application/json", "x".repeat(4096)],
])("preserves small HTML hints and non-HTML Link headers (%s)", async (contentType, link) => {
	const response = await handleRequest({
		event: event("GET", "https://chat.example"),
		resolve: async () => new Response("ok", { headers: { "content-type": contentType, link } }),
	});
	expect(response.headers.get("link")).toBe(link);
});

it.each([
	["/slack/install", false],
	["/slack/install/callback", false],
	["/slack/installed", false],
	["/slack/connect", true],
	["/slack/installer", true],
])("signing in to HuggingChat before %s required: %s", async (path, required) => {
	auth.loginEnabled = true;
	const url = new URL(`https://chat.example${path}`);
	const resolve = vi.fn(async () => new Response("ok"));
	await handleRequest({
		event: {
			url,
			route: { id: path },
			locals: {},
			params: {},
			cookies: {},
			request: new Request(url),
		} as unknown as Parameters<typeof handleRequest>[0]["event"],
		resolve,
	});
	expect(vi.mocked(triggerOauthFlow).mock.calls.length > 0).toBe(required);
	expect(resolve.mock.calls.length > 0).toBe(!required);
});
