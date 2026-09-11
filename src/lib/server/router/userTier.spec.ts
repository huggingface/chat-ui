import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ObjectId } from "mongodb";

const mockConfig = vi.hoisted(() => ({
	LLM_ROUTER_FREE_USER_MODEL: "",
	OPENID_SCOPES: "openid profile inference-api read-billing",
	OPENID_PROVIDER_URL: "https://huggingface.co",
	OPENID_CONFIG: "",
}));

const loggerMock = vi.hoisted(() => ({
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
}));

vi.mock("$lib/server/config", () => ({ config: mockConfig }));
vi.mock("$lib/server/logger", () => ({ logger: loggerMock }));

const {
	resolveUserTier,
	getFreeUserModel,
	findFreeUserMultimodalModel,
	validateFreeTierRouterConfig,
} = await import("./userTier");

const fetchMock = vi.fn();

interface UserInfoBody {
	isPro?: boolean;
	canPay?: boolean;
	orgs?: { preferred_username?: string; plan?: string; canPay?: boolean }[];
}

function userInfoResponse(body: UserInfoBody, status = 200) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function makeLocals(overrides: Record<string, unknown> = {}): App.Locals {
	return {
		sessionId: "session",
		isAdmin: false,
		user: { _id: new ObjectId() },
		token: "oauth-token",
		...overrides,
	} as unknown as App.Locals;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal("fetch", fetchMock);
	mockConfig.LLM_ROUTER_FREE_USER_MODEL = "deepseek-ai/DeepSeek-V4-Flash-0731";
	mockConfig.OPENID_SCOPES = "openid profile inference-api read-billing";
	mockConfig.OPENID_PROVIDER_URL = "https://huggingface.co";
	mockConfig.OPENID_CONFIG = "";
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("getFreeUserModel", () => {
	it("returns an empty string when the free model is unset", () => {
		mockConfig.LLM_ROUTER_FREE_USER_MODEL = "";
		expect(getFreeUserModel()).toBe("");
	});

	it("returns the trimmed configured model", () => {
		mockConfig.LLM_ROUTER_FREE_USER_MODEL = " deepseek-ai/DeepSeek-V4-Flash-0731 ";
		expect(getFreeUserModel()).toBe("deepseek-ai/DeepSeek-V4-Flash-0731");
	});
});

describe("findFreeUserMultimodalModel", () => {
	const models = [
		{ id: "text/model", name: "text/model", isRouter: false, multimodal: false },
		{ id: "vl/model", name: "vl/model", isRouter: false, multimodal: true },
	];

	it("returns undefined when the feature is disabled", () => {
		mockConfig.LLM_ROUTER_FREE_USER_MODEL = "";
		expect(findFreeUserMultimodalModel(models)).toBeUndefined();
	});

	it("returns undefined when the free model is text-only", () => {
		mockConfig.LLM_ROUTER_FREE_USER_MODEL = "text/model";
		expect(findFreeUserMultimodalModel(models)).toBeUndefined();
	});

	it("returns the free model when it is multimodal-capable", () => {
		mockConfig.LLM_ROUTER_FREE_USER_MODEL = "vl/model";
		expect(findFreeUserMultimodalModel(models)).toBe(models[1]);
	});
});

describe("resolveUserTier", () => {
	it("returns paid without any lookup when the feature is disabled", async () => {
		mockConfig.LLM_ROUTER_FREE_USER_MODEL = "";
		await expect(resolveUserTier(makeLocals())).resolves.toBe("paid");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns paid without a lookup when the OpenID provider is not the Hub", async () => {
		mockConfig.OPENID_PROVIDER_URL = "https://auth.example.com";
		await expect(resolveUserTier(makeLocals())).resolves.toBe("paid");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("honors a non-Hub PROVIDER_URL set via OPENID_CONFIG", async () => {
		mockConfig.OPENID_CONFIG = '{ PROVIDER_URL: "https://auth.example.com" }';
		await expect(resolveUserTier(makeLocals())).resolves.toBe("paid");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns free without a lookup when there is no user", async () => {
		await expect(resolveUserTier(makeLocals({ user: undefined }))).resolves.toBe("free");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns free without a lookup when there is no token", async () => {
		await expect(resolveUserTier(makeLocals({ token: undefined }))).resolves.toBe("free");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns paid for PRO subscribers", async () => {
		fetchMock.mockResolvedValueOnce(userInfoResponse({ isPro: true, canPay: false }));
		await expect(resolveUserTier(makeLocals())).resolves.toBe("paid");
	});

	it("returns paid when the user can pay", async () => {
		fetchMock.mockResolvedValueOnce(userInfoResponse({ isPro: false, canPay: true }));
		await expect(resolveUserTier(makeLocals())).resolves.toBe("paid");
	});

	it("returns free when the user has no payment signal", async () => {
		fetchMock.mockResolvedValueOnce(userInfoResponse({ isPro: false, canPay: false, orgs: [] }));
		await expect(resolveUserTier(makeLocals())).resolves.toBe("free");
	});

	it("returns paid when the selected billing org can pay", async () => {
		fetchMock.mockResolvedValueOnce(
			userInfoResponse({
				isPro: false,
				canPay: false,
				orgs: [{ preferred_username: "acme", canPay: true }],
			})
		);
		await expect(resolveUserTier(makeLocals({ billingOrganization: "acme" }))).resolves.toBe(
			"paid"
		);
	});

	it("returns paid when the selected billing org has a plan", async () => {
		fetchMock.mockResolvedValueOnce(
			userInfoResponse({
				isPro: false,
				canPay: false,
				orgs: [{ preferred_username: "acme", plan: "enterprise" }],
			})
		);
		await expect(resolveUserTier(makeLocals({ billingOrganization: "acme" }))).resolves.toBe(
			"paid"
		);
	});

	it("ignores paying orgs that are not the selected billing org", async () => {
		fetchMock.mockResolvedValueOnce(
			userInfoResponse({
				isPro: false,
				canPay: false,
				orgs: [{ preferred_username: "acme", canPay: true }],
			})
		);
		await expect(resolveUserTier(makeLocals({ billingOrganization: "other" }))).resolves.toBe(
			"free"
		);
	});

	it("returns free when the selected billing org cannot pay", async () => {
		fetchMock.mockResolvedValueOnce(
			userInfoResponse({
				isPro: false,
				canPay: false,
				orgs: [{ preferred_username: "acme" }],
			})
		);
		await expect(resolveUserTier(makeLocals({ billingOrganization: "acme" }))).resolves.toBe(
			"free"
		);
	});

	it("fails open to paid on network errors and caches the failure", async () => {
		const locals = makeLocals();
		fetchMock.mockRejectedValueOnce(new Error("boom"));
		await expect(resolveUserTier(locals)).resolves.toBe("paid");
		await expect(resolveUserTier(locals)).resolves.toBe("paid");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(loggerMock.warn).toHaveBeenCalled();
	});

	it("fails open to paid on non-2xx responses", async () => {
		fetchMock.mockResolvedValueOnce(userInfoResponse({}, 401));
		await expect(resolveUserTier(makeLocals())).resolves.toBe("paid");
	});

	it("caches the tier per user and refetches after the TTL", async () => {
		vi.useFakeTimers();
		const locals = makeLocals();
		fetchMock.mockResolvedValue(userInfoResponse({ isPro: false, canPay: false }));

		await expect(resolveUserTier(locals)).resolves.toBe("free");
		await expect(resolveUserTier(locals)).resolves.toBe("free");
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
		await expect(resolveUserTier(locals)).resolves.toBe("free");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("uses the current billing org against the cached billing data", async () => {
		const userId = new ObjectId();
		fetchMock.mockResolvedValueOnce(
			userInfoResponse({
				isPro: false,
				canPay: false,
				orgs: [{ preferred_username: "acme", canPay: true }],
			})
		);
		await expect(resolveUserTier(makeLocals({ user: { _id: userId } }))).resolves.toBe("free");
		// Same user switches billing org; the cached lookup is reused but the tier flips.
		await expect(
			resolveUserTier(makeLocals({ user: { _id: userId }, billingOrganization: "acme" }))
		).resolves.toBe("paid");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("keeps separate cache entries per user", async () => {
		fetchMock.mockResolvedValue(userInfoResponse({ isPro: false, canPay: false }));
		await resolveUserTier(makeLocals());
		await resolveUserTier(makeLocals());
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("coalesces concurrent lookups for the same user into one fetch", async () => {
		const locals = makeLocals();
		fetchMock.mockResolvedValue(userInfoResponse({ isPro: false, canPay: false }));
		await expect(
			Promise.all([resolveUserTier(locals), resolveUserTier(locals), resolveUserTier(locals)])
		).resolves.toEqual(["free", "free", "free"]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("validateFreeTierRouterConfig", () => {
	const models = [
		{ id: "deepseek-ai/DeepSeek-V4-Flash-0731", name: "deepseek-ai/DeepSeek-V4-Flash-0731" },
		{ id: "moonshotai/Kimi-K2.6", name: "moonshotai/Kimi-K2.6" },
	];

	it("does nothing when the feature is disabled", () => {
		mockConfig.LLM_ROUTER_FREE_USER_MODEL = "";
		validateFreeTierRouterConfig(models);
		expect(loggerMock.error).not.toHaveBeenCalled();
	});

	it("errors when the configured model is not in the model list", () => {
		mockConfig.LLM_ROUTER_FREE_USER_MODEL = "missing/model";
		validateFreeTierRouterConfig(models);
		expect(loggerMock.error).toHaveBeenCalledTimes(1);
	});

	it("errors when read-billing is missing from the OpenID scopes", () => {
		mockConfig.OPENID_SCOPES = "openid profile";
		validateFreeTierRouterConfig(models);
		expect(loggerMock.error).toHaveBeenCalledTimes(1);
	});

	it("errors when enabled with a non-Hub OpenID provider", () => {
		mockConfig.OPENID_PROVIDER_URL = "https://auth.example.com";
		validateFreeTierRouterConfig(models);
		expect(loggerMock.error).toHaveBeenCalledTimes(1);
	});

	it("stays silent on a valid configuration", () => {
		validateFreeTierRouterConfig(models);
		expect(loggerMock.warn).not.toHaveBeenCalled();
		expect(loggerMock.error).not.toHaveBeenCalled();
	});
});
