import { describe, it, expect, beforeEach } from "vitest";
import superjson from "superjson";
import { collections } from "$lib/server/database";
import { createTestLocals, createTestUser, cleanupTestData } from "./testHelpers";
import { GET as userGET } from "../../../../routes/api/v2/user/+server";
import {
	GET as settingsGET,
	POST as settingsPOST,
} from "../../../../routes/api/v2/user/settings/+server";

async function parseResponse<T = unknown>(res: Response): Promise<T> {
	return superjson.parse(await res.text()) as T;
}

function mockRequestEvent(locals: App.Locals, overrides?: Record<string, unknown>) {
	return {
		locals,
		url: new URL("http://localhost"),
		request: new Request("http://localhost"),
		...overrides,
	} as Parameters<typeof userGET>[0];
}

describe("GET /api/v2/user", () => {
	beforeEach(async () => {
		await cleanupTestData();
	});

	it("returns user info for authenticated user", async () => {
		const { user, locals } = await createTestUser();

		const res = await userGET(mockRequestEvent(locals));
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

		const res = await userGET(mockRequestEvent(locals));
		const data = await parseResponse(res);

		expect(data).toBeNull();
	});
});

describe("GET /api/v2/user/settings", () => {
	beforeEach(async () => {
		await cleanupTestData();
	});

	it("returns default settings when none exist", async () => {
		const { locals } = await createTestUser();

		const res = await settingsGET(mockRequestEvent(locals));
		const data = await parseResponse<Record<string, unknown>>(res);

		expect(data).toMatchObject({
			welcomeModalSeen: false,
			welcomeModalSeenAt: null,
			disableStream: false,
			directPaste: false,
			shareConversationsWithModelAuthors: true,
			customPrompts: {},
			multimodalOverrides: {},
			toolsOverrides: {},
			providerOverrides: {},
		});
	});

	it("returns stored settings", async () => {
		const { user, locals } = await createTestUser();

		await collections.settings.insertOne({
			userId: user._id,
			shareConversationsWithModelAuthors: false,
			activeModel: "custom-model",
			disableStream: true,
			directPaste: true,
			customPrompts: { "my-model": "Be helpful" },
			multimodalOverrides: {},
			toolsOverrides: {},
			hidePromptExamples: {},
			providerOverrides: {},
			welcomeModalSeenAt: new Date("2024-01-01"),
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		const res = await settingsGET(mockRequestEvent(locals));
		const data = await parseResponse<Record<string, unknown>>(res);

		expect(data).toMatchObject({
			welcomeModalSeen: true,
			shareConversationsWithModelAuthors: false,
			disableStream: true,
			directPaste: true,
			customPrompts: { "my-model": "Be helpful" },
		});
	});
});

describe("POST /api/v2/user/settings", () => {
	beforeEach(async () => {
		await cleanupTestData();
	});

	it("creates settings with upsert", async () => {
		const { user, locals } = await createTestUser();

		const body = {
			shareConversationsWithModelAuthors: false,
			activeModel: "test-model",
			customPrompts: {},
			multimodalOverrides: {},
			toolsOverrides: {},
			providerOverrides: {},
			disableStream: true,
			directPaste: false,
			hidePromptExamples: {},
		};

		const res = await settingsPOST(
			mockRequestEvent(locals, {
				request: new Request("http://localhost", {
					method: "POST",
					body: JSON.stringify(body),
					headers: { "Content-Type": "application/json" },
				}),
			})
		);

		expect(res.status).toBe(200);

		const stored = await collections.settings.findOne({ userId: user._id });
		expect(stored).not.toBeNull();
		expect(stored?.shareConversationsWithModelAuthors).toBe(false);
		expect(stored?.disableStream).toBe(true);
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
			disableStream: false,
			directPaste: false,
			hidePromptExamples: {},
		};

		await settingsPOST(
			mockRequestEvent(locals, {
				request: new Request("http://localhost", {
					method: "POST",
					body: JSON.stringify(body),
					headers: { "Content-Type": "application/json" },
				}),
			})
		);

		const stored = await collections.settings.findOne({ userId: user._id });
		expect(stored).not.toBeNull();
		expect(stored?.welcomeModalSeenAt).toBeInstanceOf(Date);
	});

	it("validates body with Zod and applies defaults for missing fields", async () => {
		const { user, locals } = await createTestUser();

		// POST with minimal body — Zod defaults should fill in the rest
		const body = {};

		const res = await settingsPOST(
			mockRequestEvent(locals, {
				request: new Request("http://localhost", {
					method: "POST",
					body: JSON.stringify(body),
					headers: { "Content-Type": "application/json" },
				}),
			})
		);

		expect(res.status).toBe(200);

		const stored = await collections.settings.findOne({ userId: user._id });
		expect(stored).not.toBeNull();
		// Zod defaults should be applied
		expect(stored?.shareConversationsWithModelAuthors).toBe(true);
		expect(stored?.disableStream).toBe(false);
		expect(stored?.directPaste).toBe(false);
		expect(stored?.customPrompts).toEqual({});
	});
});
