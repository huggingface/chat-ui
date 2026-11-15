import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock("$lib/server/config", () => ({
	config: new Proxy({}, { get: (_, key) => env[key as string] }),
}));
import { slackConfig } from "./config";

describe("public installs", () => {
	beforeEach(() => {
		for (const key of Object.keys(env)) delete env[key];
		Object.assign(env, {
			SLACK_ML_ENABLED: "true",
			SLACK_ML_TEAM_ID: "T123",
			SLACK_ML_BOT_TOKEN: "xoxb-test",
			SLACK_ML_APP_TOKEN: "xapp-test",
			SLACK_ML_ACCOUNT_MODE: "user",
			SLACK_ML_PUBLIC_INSTALL: "true",
			MCP_OAUTH_ENCRYPTION_KEY: "key",
			SLACK_ML_VIEWER_ORIGIN: "https://chat.example",
			SLACK_ML_VIEWER_SESSION_SECRET: "s".repeat(32),
		});
	});

	it("reuses the Sign in with Slack client when it is the bot's own app", () => {
		Object.assign(env, {
			SLACK_ML_VIEWER_CLIENT_ID: "1.viewer",
			SLACK_ML_VIEWER_CLIENT_SECRET: "viewer-secret",
		});
		expect(slackConfig()).toMatchObject({ clientId: "1.viewer", clientSecret: "viewer-secret" });
	});

	it("prefers a separate install client", () => {
		Object.assign(env, {
			SLACK_ML_VIEWER_CLIENT_ID: "1.viewer",
			SLACK_ML_VIEWER_CLIENT_SECRET: "viewer-secret",
			SLACK_ML_CLIENT_ID: "1.bot",
			SLACK_ML_CLIENT_SECRET: "bot-secret",
		});
		expect(slackConfig()).toMatchObject({ clientId: "1.bot", clientSecret: "bot-secret" });
	});

	it.each([
		["a client", {}],
		["an encryption key", { MCP_OAUTH_ENCRYPTION_KEY: undefined }],
		["Sign in with Slack", { SLACK_ML_VIEWER_SESSION_SECRET: undefined }],
	])("turns installs off but keeps the bot running without %s", (_, missing) => {
		Object.assign(env, { SLACK_ML_CLIENT_ID: "1.bot", SLACK_ML_CLIENT_SECRET: "bot-secret" });
		if (_ === "a client") delete env.SLACK_ML_CLIENT_ID;
		Object.assign(env, missing);
		expect(slackConfig()).toMatchObject({ teamId: "T123", publicInstall: false });
	});
});
