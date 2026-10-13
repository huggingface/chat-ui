import { it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
	flow: undefined as unknown,
	claims: { "https://slack.com/user_id": "U1", "https://slack.com/team_id": "T1" },
	callback: vi.fn(),
}));
vi.mock("./auth", () => ({
	cookieOptions: { path: "/slack/view" },
	flowCookie: "flow",
	sessionCookie: "session",
	viewerConfig: () => ({ origin: "https://viewer.example", secret: "secret" }),
	verify: () => mocks.flow,
	sign: () => "signed-session",
	oidcClient: async () => ({
		callbackParams: (url: string) => Object.fromEntries(new URL(url).searchParams),
		callback: mocks.callback,
	}),
}));
vi.mock("../config", () => ({ slackConfig: () => ({ teamId: "T1" }) }));
import { GET } from "../../../../routes/slack/view/callback/+server";
beforeEach(() => {
	vi.clearAllMocks();
	mocks.flow = {
		state: "state",
		nonce: "nonce",
		target: "a".repeat(24),
		expires: Date.now() + 60000,
	};
	mocks.callback.mockResolvedValue({ claims: () => mocks.claims });
	mocks.claims = { "https://slack.com/user_id": "U1", "https://slack.com/team_id": "T1" };
});
function event(state = "state") {
	return {
		url: new URL(`https://viewer.example/slack/view/callback?state=${state}&code=code`),
		cookies: { get: vi.fn(() => "cookie"), delete: vi.fn(), set: vi.fn() },
	};
}
it("rejects invalid state before exchanging code", async () => {
	const e = event("wrong");
	await expect(GET(e as unknown as Parameters<typeof GET>[0])).rejects.toMatchObject({
		status: 400,
	});
	expect(mocks.callback).not.toHaveBeenCalled();
	expect(e.cookies.set).not.toHaveBeenCalled();
});
it("rejects expired login state", async () => {
	mocks.flow = { ...(mocks.flow as object), expires: 0 };
	await expect(GET(event() as unknown as Parameters<typeof GET>[0])).rejects.toMatchObject({
		status: 400,
	});
});
it("passes nonce and state to the validating OIDC client and sets a session", async () => {
	const e = event();
	await expect(GET(e as unknown as Parameters<typeof GET>[0])).rejects.toMatchObject({
		status: 303,
	});
	expect(mocks.callback).toHaveBeenCalledWith(
		"https://viewer.example/slack/view/callback",
		expect.anything(),
		{ state: "state", nonce: "nonce" }
	);
	expect(e.cookies.set).toHaveBeenCalledWith(
		"session",
		"signed-session",
		expect.objectContaining({ maxAge: 3600 })
	);
});
it("refuses a valid Slack login from another workspace", async () => {
	mocks.claims["https://slack.com/team_id"] = "T2";
	const e = event();
	await expect(GET(e as unknown as Parameters<typeof GET>[0])).rejects.toMatchObject({
		status: 403,
	});
	expect(e.cookies.set).not.toHaveBeenCalled();
});
