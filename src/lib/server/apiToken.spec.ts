import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
	USE_USER_TOKEN: "",
	OPENID_PROVIDER_URL: "",
	OPENID_SCOPES: "",
}));
vi.mock("$lib/server/config", () => ({ config }));

const { getUserHubToken, getUserHubWriteToken } = await import("./apiToken");

const locals = { token: "user_token" } as App.Locals;

beforeEach(() => {
	config.USE_USER_TOKEN = "";
	config.OPENID_PROVIDER_URL = "https://huggingface.co";
	config.OPENID_SCOPES = "openid profile contribute-repos jobs";
});

describe("getUserHubToken", () => {
	it("keeps a token another provider issued away from the Hub", () => {
		config.OPENID_PROVIDER_URL = "https://auth.example.com";
		expect(getUserHubToken(locals)).toBeUndefined();
	});
});

describe("getUserHubWriteToken", () => {
	it("returns the Hub token when contribute-repos was granted", () => {
		expect(getUserHubWriteToken(locals)).toBe("user_token");
	});

	it("returns nothing without contribute-repos", () => {
		config.OPENID_SCOPES = "openid profile jobs";
		expect(getUserHubWriteToken(locals)).toBeUndefined();
	});

	it("returns nothing for a token another provider issued", () => {
		config.OPENID_PROVIDER_URL = "https://auth.example.com";
		expect(getUserHubWriteToken(locals)).toBeUndefined();
	});

	it("trusts an operator who opted into user tokens", () => {
		config.USE_USER_TOKEN = "true";
		config.OPENID_SCOPES = "openid";
		expect(getUserHubWriteToken(locals)).toBe("user_token");
	});
});
