import { describe, expect, it, vi } from "vitest";

vi.mock("$app/environment", () => ({ dev: false }));
vi.mock("$lib/server/database", () => ({
	collections: { slackThreads: { findOne: vi.fn(async () => ({ _id: "slack-thread" })) } },
}));
vi.mock("$lib/server/config", () => ({
	config: { PUBLIC_ORIGIN: "https://chat.example", checkForUpdates: vi.fn() },
	ready: Promise.resolve(),
}));
vi.mock("$lib/server/auth", () => ({
	loginEnabled: false,
	authenticateRequest: vi.fn(async () => ({ sessionId: "test" })),
	refreshSessionCookie: vi.fn(),
	triggerOauthFlow: vi.fn(),
}));
vi.mock("$lib/server/adminToken", () => ({ adminTokenManager: { isAdmin: () => false } }));
vi.mock("$lib/server/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn() } }));

import { handleRequest } from "./handle";

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
