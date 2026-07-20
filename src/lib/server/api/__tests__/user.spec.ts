import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import superjson from "superjson";
import { collections, ready } from "$lib/server/database";
import { createTestLocals, createTestUser, cleanupTestData } from "./testHelpers";
import { testRequest, TEST_ORIGIN } from "$lib/server/__tests__/testRequest";
import { GET as userGET } from "../../../../routes/api/v2/user/+server";
import {
	GET as settingsGET,
	POST as settingsPOST,
} from "../../../../routes/api/v2/user/settings/+server";

async function parseResponse<T = unknown>(res: Response): Promise<T> {
	return superjson.parse(await res.text()) as T;
}

function jsonBody(body: unknown) {
	return {
		method: "POST",
		body: JSON.stringify(body),
		headers: { "Content-Type": "application/json" },
	} as const;
}

beforeAll(async () => {
	await ready;
}, 30000);

describe("GET /api/v2/user", () => {
	beforeEach(async () => {
		await cleanupTestData();
	}, 20000);

	it("returns user info for authenticated user", async () => {
		const { user, locals } = await createTestUser();

		const res = await testRequest(userGET, { path: "/api/v2/user", locals });
		const data = await parseResponse<Record<string, unknown>>(res);

		expect(data).not.toBeNull();
		expect(data).toMatchObject({
			id: user._id.toString(),
			username: user.username,
			avatarUrl: user.avatarUrl,
			isAdmin: false,
			isEarlyAccess: false,
		});
	});

	it("returns null for unauthenticated user", async () => {
		const locals = createTestLocals();

		const res = await testRequest(userGET, { path: "/api/v2/user", locals });
		const data = await parseResponse(res);

		expect(data).toBeNull();
	});

	it("resolves the user from a session cookie, with no locals override", async () => {
		const { user, cookie } = await createTestUser();

		const res = await testRequest(userGET, { path: "/api/v2/user", headers: { cookie } });
		const data = await parseResponse<Record<string, unknown>>(res);

		expect(data).toMatchObject({ id: user._id.toString(), username: user.username });
	});

	it("returns null when the session cookie matches no stored session", async () => {
		const res = await testRequest(userGET, {
			path: "/api/v2/user",
			headers: { cookie: "hf-chat=not-a-real-session" },
		});

		expect(await parseResponse(res)).toBeNull();
	});
});

describe("GET /api/v2/user/settings", () => {
	beforeEach(async () => {
		await cleanupTestData();
	}, 20000);

	it("returns default settings when none exist", async () => {
		const { locals } = await createTestUser();

		const res = await testRequest(settingsGET, { path: "/api/v2/user/settings", locals });
		const data = await parseResponse<Record<string, unknown>>(res);

		expect(data).toMatchObject({
			welcomeModalSeen: false,
			welcomeModalSeenAt: null,
			streamingMode: "smooth",
			directPaste: false,
			shareConversationsWithModelAuthors: true,
			customPrompts: {},
			multimodalOverrides: {},
			toolsOverrides: {},
			providerOverrides: {},
		});
	});

	it("returns stored settings with canonical streaming mode", async () => {
		const { user, locals } = await createTestUser();

		await collections.settings.insertOne({
			userId: user._id,
			shareConversationsWithModelAuthors: false,
			activeModel: "custom-model",
			streamingMode: "raw",
			directPaste: true,
			hapticsEnabled: true,
			customPrompts: { "my-model": "Be helpful" },
			multimodalOverrides: {},
			toolsOverrides: {},
			hidePromptExamples: {},
			providerOverrides: {},
			welcomeModalSeenAt: new Date("2024-01-01"),
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		const res = await testRequest(settingsGET, { path: "/api/v2/user/settings", locals });
		const data = await parseResponse<Record<string, unknown>>(res);

		expect(data).toMatchObject({
			welcomeModalSeen: true,
			shareConversationsWithModelAuthors: false,
			streamingMode: "raw",
			directPaste: true,
			customPrompts: { "my-model": "Be helpful" },
		});
	});

	it("maps legacy stored streamingMode=final to smooth", async () => {
		const { user, locals } = await createTestUser();

		const legacySettingsWithFinal = {
			userId: user._id,
			shareConversationsWithModelAuthors: true,
			activeModel: "custom-model",
			streamingMode: "final",
			directPaste: false,
			customPrompts: {},
			multimodalOverrides: {},
			toolsOverrides: {},
			hidePromptExamples: {},
			providerOverrides: {},
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		await collections.settings.insertOne(
			legacySettingsWithFinal as unknown as Parameters<typeof collections.settings.insertOne>[0]
		);

		const res = await testRequest(settingsGET, { path: "/api/v2/user/settings", locals });
		const data = await parseResponse<Record<string, unknown>>(res);

		expect(data).toMatchObject({
			streamingMode: "smooth",
		});
	});
});

describe("POST /api/v2/user/settings", () => {
	beforeEach(async () => {
		await cleanupTestData();
	}, 20000);

	it("creates settings with upsert", async () => {
		const { user, locals } = await createTestUser();

		const body = {
			shareConversationsWithModelAuthors: false,
			activeModel: "test-model",
			customPrompts: {},
			multimodalOverrides: {},
			toolsOverrides: {},
			providerOverrides: {},
			streamingMode: "raw",
			directPaste: false,
			hidePromptExamples: {},
		};

		const res = await testRequest(settingsPOST, {
			path: "/api/v2/user/settings",
			locals,
			...jsonBody(body),
		});

		expect(res.status).toBe(200);

		const stored = await collections.settings.findOne({ userId: user._id });
		expect(stored).not.toBeNull();
		expect(stored?.shareConversationsWithModelAuthors).toBe(false);
		expect(stored?.streamingMode).toBe("raw");
		expect(stored?.createdAt).toBeInstanceOf(Date);
		expect(stored?.updatedAt).toBeInstanceOf(Date);
	});

	it("sets welcomeModalSeenAt when welcomeModalSeen is true", async () => {
		const { user, locals } = await createTestUser();

		const body = {
			welcomeModalSeen: true,
			shareConversationsWithModelAuthors: true,
			activeModel: "test-model",
			customPrompts: {},
			multimodalOverrides: {},
			toolsOverrides: {},
			providerOverrides: {},
			streamingMode: "smooth",
			directPaste: false,
			hidePromptExamples: {},
		};

		await testRequest(settingsPOST, {
			path: "/api/v2/user/settings",
			locals,
			...jsonBody(body),
		});

		const stored = await collections.settings.findOne({ userId: user._id });
		expect(stored).not.toBeNull();
		expect(stored?.welcomeModalSeenAt).toBeInstanceOf(Date);
	});

	it("validates body with Zod and applies defaults for missing fields", async () => {
		const { user, locals } = await createTestUser();

		// POST with minimal body — Zod defaults should fill in the rest
		const body = {};

		const res = await testRequest(settingsPOST, {
			path: "/api/v2/user/settings",
			locals,
			...jsonBody(body),
		});

		expect(res.status).toBe(200);

		const stored = await collections.settings.findOne({ userId: user._id });
		expect(stored).not.toBeNull();
		// Zod defaults should be applied
		expect(stored?.shareConversationsWithModelAuthors).toBe(true);
		expect(stored?.streamingMode).toBe("smooth");
		expect(stored?.directPaste).toBe(false);
		expect(stored?.customPrompts).toEqual({});
	});
});

describe("handle hook, via POST /api/v2/user/settings", () => {
	beforeEach(async () => {
		await cleanupTestData();
	}, 20000);

	it("exempts application/json POSTs from the CSRF origin check", async () => {
		const { locals } = await createTestUser();

		const res = await testRequest(settingsPOST, {
			path: "/api/v2/user/settings",
			locals,
			...jsonBody({}),
		});

		expect(res.status).toBe(200);
	});

	it.each(["multipart/form-data", "application/x-www-form-urlencoded", "text/plain"])(
		"rejects a %s POST that carries no Origin",
		async (contentType) => {
			const { locals } = await createTestUser();

			const res = await testRequest(settingsPOST, {
				path: "/api/v2/user/settings",
				method: "POST",
				body: "welcomeModalSeen=true",
				headers: { "Content-Type": contentType },
				locals,
			});

			expect(res.status).toBe(403);
			expect(await res.text()).toBe("Non-JSON form requests need to have an origin");
		}
	);

	it("rejects a native-form POST whose Origin is a different host", async () => {
		const { locals } = await createTestUser();

		const res = await testRequest(settingsPOST, {
			path: "/api/v2/user/settings",
			method: "POST",
			body: "welcomeModalSeen=true",
			headers: { "Content-Type": "text/plain", origin: "https://evil.example" },
			locals,
		});

		expect(res.status).toBe(403);
		expect(await res.text()).toBe("Invalid referer for POST request");
	});

	it("accepts a native-form POST whose Origin matches the request host", async () => {
		const { locals } = await createTestUser();

		const res = await testRequest(settingsPOST, {
			path: "/api/v2/user/settings",
			method: "POST",
			body: JSON.stringify({}),
			headers: { "Content-Type": "text/plain", origin: TEST_ORIGIN },
			locals,
		});

		expect(res.status).toBe(200);
	});

	it("refreshes the session cookie on POST", async () => {
		const { cookie, secretSessionId } = await createTestUser();

		const res = await testRequest(settingsPOST, {
			path: "/api/v2/user/settings",
			headers: { cookie, "Content-Type": "application/json" },
			method: "POST",
			body: JSON.stringify({}),
		});

		const setCookie = res.headers.get("set-cookie");
		expect(setCookie).toContain(`hf-chat=${secretSessionId}`);
		expect(setCookie).toContain("HttpOnly");
		expect(setCookie).toContain("Path=/");
	});

	it("extends the stored session's expiry on POST", async () => {
		const { cookie, session } = await createTestUser();
		const before = await collections.sessions.findOne({ sessionId: session.sessionId });

		await testRequest(settingsPOST, {
			path: "/api/v2/user/settings",
			headers: { cookie, "Content-Type": "application/json" },
			method: "POST",
			body: JSON.stringify({}),
		});

		const after = await collections.sessions.findOne({ sessionId: session.sessionId });
		expect(after?.expiresAt.getTime()).toBeGreaterThan(before?.expiresAt.getTime() ?? 0);
	});
});
