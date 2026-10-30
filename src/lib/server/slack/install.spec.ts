import { readFileSync } from "node:fs";
import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collections, ready } from "$lib/server/database";
import { cleanupTestData } from "$lib/server/api/__tests__/testHelpers";
import { completeInstall, InstallError } from "./install";
import {
	removeInstallation,
	slackInstalled,
	slackWorkspace,
	SLACK_BOT_SCOPES,
	workspaceClient,
} from "./installations";
import type { SlackConfig } from "./config";
import { GET as install } from "../../../routes/slack/install/+server";
import { GET as callback } from "../../../routes/slack/install/callback/+server";
import { load as installed } from "../../../routes/slack/installed/+page.server";

const mocks = vi.hoisted(() => ({ access: vi.fn(), post: vi.fn(), tokens: [] as string[] }));
vi.mock("$lib/server/config", async (original) => {
	const m = await original<typeof import("$lib/server/config")>();
	return {
		...m,
		config: new Proxy(m.config, {
			get(target, key) {
				if (key === "MCP_OAUTH_ENCRYPTION_KEY") return "test-encryption-key";
				return Reflect.get(target, key);
			},
		}),
	};
});
vi.mock("./links", () => ({ chatOrigin: () => "https://huggingface.co" }));
vi.mock("@slack/web-api", () => ({
	WebClient: class {
		constructor(token?: string) {
			if (token) mocks.tokens.push(token);
		}
		oauth = { v2: { access: mocks.access } };
		auth = { test: async () => ({ team_id: "THOME", user_id: "UHOME", bot_id: "BHOME" }) };
		bots = { info: async () => ({ bot: { app_id: "AAPP" } }) };
		chat = { postMessage: mocks.post };
	},
}));
const settings: SlackConfig = {
	teamId: "THOME",
	botToken: "xoxb-home",
	appToken: "xapp-test",
	hfToken: "",
	accountMode: "user",
	budgetUsd: 0,
	allowedChannels: [],
	publicInstall: true,
	clientId: "123.456",
	clientSecret: "secret",
};
vi.mock("./config", () => ({ slackConfig: () => settings }));
vi.mock("./viewer/auth", async (original) => ({
	...(await original<typeof import("./viewer/auth")>()),
	viewerConfig: () => ({ secret: "s".repeat(32) }),
}));

const granted = {
	ok: true,
	app_id: "AAPP",
	access_token: "xoxb-acme",
	token_type: "bot",
	scope: SLACK_BOT_SCOPES.join(","),
	bot_user_id: "UACMEBOT",
	team: { id: "TACME", name: "Acme" },
	authed_user: { id: "UADMIN" },
};

beforeEach(async () => {
	await ready;
	vi.clearAllMocks();
	mocks.tokens.length = 0;
	mocks.post.mockResolvedValue({ ok: true });
});
afterEach(async () => {
	await cleanupTestData();
});

it("requests exactly the manifest's bot scopes", () => {
	const manifest = JSON.parse(
		readFileSync(new URL("../../../../integrations/slack/manifest.json", import.meta.url), "utf8")
	);
	expect(SLACK_BOT_SCOPES).toEqual(manifest.oauth_config.scopes.bot);
});

describe("completeInstall", () => {
	it("stores the workspace's bot token encrypted and greets the installer", async () => {
		mocks.access.mockResolvedValue(granted);
		await expect(completeInstall(settings, "code")).resolves.toEqual({
			teamId: "TACME",
			teamName: "Acme",
			appId: "AAPP",
		});
		expect(mocks.access).toHaveBeenCalledWith(
			expect.objectContaining({
				code: "code",
				redirect_uri: expect.stringMatching(
					/^https:\/\/huggingface\.co\/.*slack\/install\/callback$/
				),
			})
		);
		const row = await collections.slackInstallations.findOne({ _id: "TACME" });
		expect(row).toMatchObject({ teamName: "Acme", botUserId: "UACMEBOT", installedBy: "UADMIN" });
		expect(row?.botToken).not.toContain("xoxb-acme");
		expect(await slackWorkspace("TACME")).toEqual({
			teamId: "TACME",
			botToken: "xoxb-acme",
			botUserId: "UACMEBOT",
		});
		expect(mocks.post).toHaveBeenCalledWith(
			expect.objectContaining({ channel: "UADMIN", text: expect.stringContaining("<@UACMEBOT>") })
		);
	});

	it.each([
		["an org-wide Enterprise Grid install", { is_enterprise_install: true, team: null }],
		["another Slack app's install", { app_id: "AOTHER" }],
		["an install missing scopes", { scope: "chat:write" }],
		["a user token", { token_type: "user", access_token: "xoxp-acme" }],
	])("rejects %s without storing it", async (_, override) => {
		mocks.access.mockResolvedValue({ ...granted, ...override });
		await expect(completeInstall(settings, "code")).rejects.toBeInstanceOf(InstallError);
		expect(await collections.slackInstallations.countDocuments({})).toBe(0);
		expect(mocks.post).not.toHaveBeenCalled();
	});

	it("reports a rejected code as an install error", async () => {
		mocks.access.mockRejectedValue(new Error("invalid_code"));
		await expect(completeInstall(settings, "code")).rejects.toBeInstanceOf(InstallError);
	});

	it("keeps the home workspace on the deployment's own token", async () => {
		mocks.access.mockResolvedValue({ ...granted, team: { id: "THOME", name: "Home" } });
		await completeInstall(settings, "code");
		expect(await collections.slackInstallations.countDocuments({})).toBe(0);
		expect(await workspaceClient("THOME")).toBeDefined();
		expect(mocks.tokens).toContain("xoxb-home");
	});
});

describe("installations", () => {
	const install = (teamId: string, extra: object = {}) =>
		collections.slackInstallations.insertOne({
			_id: teamId,
			teamName: teamId,
			appId: "AAPP",
			botToken: `xoxb-${teamId}`,
			botUserId: `U${teamId}`,
			scopes: SLACK_BOT_SCOPES,
			installedBy: "UADMIN",
			installedAt: new Date(),
			updatedAt: new Date(),
			...extra,
		});

	it("serves the home workspace and enabled installs only", async () => {
		await install("TONE");
		await install("TOFF", { disabled: true });
		expect(await slackInstalled("THOME")).toBe(true);
		expect(await slackInstalled("TONE")).toBe(true);
		expect(await slackInstalled("TOFF")).toBe(false);
		expect(await slackInstalled("TNONE")).toBe(false);
		expect(await slackInstalled("TONE", { ...settings, publicInstall: false })).toBe(false);
	});

	it("forgets an uninstalled workspace and stops polling its threads", async () => {
		await install("TGONE");
		const now = new Date();
		await collections.slackThreads.insertMany(
			["TGONE", "THOME"].map((teamId) => ({
				_id: `${teamId}:C1:1.0`,
				teamId,
				channel: "C1",
				threadTs: "1.0",
				owner: "U1",
				conversationId: new ObjectId(),
				watching: true,
				createdAt: now,
				updatedAt: now,
			}))
		);
		expect(await slackInstalled("TGONE")).toBe(true);
		await removeInstallation("TGONE");
		expect(await slackInstalled("TGONE")).toBe(false);
		expect(await collections.slackThreads.findOne({ teamId: "TGONE" })).toMatchObject({
			watching: false,
		});
		expect(await collections.slackThreads.findOne({ teamId: "THOME" })).toMatchObject({
			watching: true,
		});
	});
});

describe("install routes", () => {
	const cookieJar = () => {
		const jar = new Map<string, string>();
		return {
			jar,
			cookies: {
				get: (name: string) => jar.get(name),
				set: (name: string, value: string) => void jar.set(name, value),
				delete: (name: string) => void jar.delete(name),
			},
		};
	};
	const run = async (handler: () => unknown) => {
		try {
			await handler();
		} catch (e) {
			return e as { status: number; location?: string; body?: { message: string } };
		}
		throw new Error("Expected a redirect or error");
	};
	type Event = Parameters<typeof callback>[0];

	it("sends the shareable link straight to Slack's consent screen", async () => {
		const { jar, cookies } = cookieJar();
		const result = await run(() =>
			install({ cookies } as unknown as Parameters<typeof install>[0])
		);
		const url = new URL(result.location ?? "");
		expect(result.status).toBe(302);
		expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
		expect(url.searchParams.get("client_id")).toBe("123.456");
		expect(url.searchParams.get("scope")).toBe(SLACK_BOT_SCOPES.join(","));
		expect(url.searchParams.get("state")).toBe(jar.get("__Secure-ml-slack-install"));
	});

	it("rejects a callback whose state does not match the browser's install", async () => {
		const { jar, cookies } = cookieJar();
		jar.set("__Secure-ml-slack-install", "mine");
		const url = new URL("https://huggingface.co/chat/slack/install/callback?code=c&state=theirs");
		const result = await run(() => callback({ url, cookies } as unknown as Event));
		expect(result.status).toBe(400);
		expect(mocks.access).not.toHaveBeenCalled();
	});

	it("completes installs Slack starts itself and shows the workspace", async () => {
		mocks.access.mockResolvedValue(granted);
		const { jar, cookies } = cookieJar();
		const url = new URL("https://huggingface.co/chat/slack/install/callback?code=c");
		const result = await run(() => callback({ url, cookies } as unknown as Event));
		expect(result.status).toBe(303);
		expect(await slackInstalled("TACME")).toBe(true);
		const page = await installed({
			url: new URL("https://huggingface.co/chat/slack/installed"),
			cookies,
			setHeaders: () => {},
		} as unknown as Parameters<typeof installed>[0]);
		expect(page).toMatchObject({
			installed: {
				teamName: "Acme",
				slackUrl: "https://slack.com/app_redirect?app=AAPP&team=TACME",
			},
		});
		expect(jar.has("__Secure-ml-slack-installed")).toBe(true);
	});

	it("shows a cancelled install without calling Slack", async () => {
		const { cookies } = cookieJar();
		const url = new URL(
			"https://huggingface.co/chat/slack/install/callback?error=access_denied&state=x"
		);
		const result = await run(() => callback({ url, cookies } as unknown as Event));
		expect(result.status).toBe(303);
		expect(result.location).toContain("/slack/installed?cancelled=1");
		expect(mocks.access).not.toHaveBeenCalled();
	});
});
