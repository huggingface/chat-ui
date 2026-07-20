import { describe, expect, it, afterEach, beforeAll } from "vitest";
import superjson from "superjson";
import { collections, ready } from "$lib/server/database";
import { CONV_NUM_PER_PAGE } from "$lib/constants/pagination";
import {
	createTestLocals,
	createTestUser,
	createTestConversation,
	cleanupTestData,
} from "./testHelpers";
import { testRequest } from "$lib/server/__tests__/testRequest";

import { GET, DELETE } from "../../../../routes/api/v2/conversations/+server";

async function parseResponse<T = unknown>(res: Response): Promise<T> {
	return superjson.parse(await res.text()) as T;
}

function conversationsPath(params?: Record<string, string>): string {
	const query = params ? `?${new URLSearchParams(params)}` : "";
	return `/api/v2/conversations${query}`;
}

beforeAll(async () => {
	await ready;
}, 30000);

describe.sequential("GET /api/v2/conversations", () => {
	afterEach(async () => {
		await cleanupTestData();
	});

	it("returns conversations for authenticated user", { timeout: 30000 }, async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { title: "My Chat" });

		const res = await testRequest(GET, { path: conversationsPath(), locals });

		expect(res.status).toBe(200);
		const data = await parseResponse<{
			conversations: Array<{ title: string; _id: { toString(): string } }>;
			hasMore: boolean;
		}>(res);
		expect(data.conversations).toHaveLength(1);
		expect(data.conversations[0].title).toBe("My Chat");
		expect(data.conversations[0]._id.toString()).toBe(conv._id.toString());
		expect(data.hasMore).toBe(false);
	});

	it("returns empty array for user with no conversations", async () => {
		const { locals } = await createTestUser();

		const res = await testRequest(GET, { path: conversationsPath(), locals });

		expect(res.status).toBe(200);
		const data = await parseResponse<{ conversations: unknown[]; hasMore: boolean }>(res);
		expect(data.conversations).toHaveLength(0);
		expect(data.hasMore).toBe(false);
	});

	it("supports pagination with p=0 and p=1", async () => {
		const { locals } = await createTestUser();

		// Create CONV_NUM_PER_PAGE + 5 conversations with distinct updatedAt values
		for (let i = 0; i < CONV_NUM_PER_PAGE + 5; i++) {
			await createTestConversation(locals, {
				title: `Conv ${i}`,
				updatedAt: new Date(Date.now() - (CONV_NUM_PER_PAGE + 5 - i) * 1000),
			});
		}

		const resPage0 = await testRequest(GET, { path: conversationsPath({ p: "0" }), locals });

		const dataPage0 = await parseResponse<{
			conversations: Array<{ title: string }>;
			hasMore: boolean;
		}>(resPage0);
		expect(dataPage0.conversations).toHaveLength(CONV_NUM_PER_PAGE);
		expect(dataPage0.hasMore).toBe(true);

		const resPage1 = await testRequest(GET, { path: conversationsPath({ p: "1" }), locals });

		const dataPage1 = await parseResponse<{
			conversations: Array<{ title: string }>;
			hasMore: boolean;
		}>(resPage1);
		expect(dataPage1.conversations).toHaveLength(5);
		expect(dataPage1.hasMore).toBe(false);
	});

	it("returns hasMore=true when more than CONV_NUM_PER_PAGE exist", async () => {
		const { locals } = await createTestUser();

		for (let i = 0; i < CONV_NUM_PER_PAGE + 1; i++) {
			await createTestConversation(locals, {
				title: `Conv ${i}`,
				updatedAt: new Date(Date.now() - i * 1000),
			});
		}

		const res = await testRequest(GET, { path: conversationsPath(), locals });

		const data = await parseResponse<{ conversations: unknown[]; hasMore: boolean }>(res);
		expect(data.conversations).toHaveLength(CONV_NUM_PER_PAGE);
		expect(data.hasMore).toBe(true);
	});

	it("sorts by updatedAt descending", async () => {
		const { locals } = await createTestUser();

		await createTestConversation(locals, {
			title: "Oldest",
			updatedAt: new Date("2024-01-01"),
		});
		await createTestConversation(locals, {
			title: "Newest",
			updatedAt: new Date("2024-06-01"),
		});
		await createTestConversation(locals, {
			title: "Middle",
			updatedAt: new Date("2024-03-01"),
		});

		const res = await testRequest(GET, { path: conversationsPath(), locals });

		const data = await parseResponse<{ conversations: Array<{ title: string }> }>(res);
		expect(data.conversations[0].title).toBe("Newest");
		expect(data.conversations[1].title).toBe("Middle");
		expect(data.conversations[2].title).toBe("Oldest");
	});

	it("returns 401 for unauthenticated request", async () => {
		const locals = createTestLocals({ sessionId: undefined, user: undefined });

		const res = await testRequest(GET, { path: conversationsPath(), locals });

		expect(res.status).toBe(401);
	});

	it("does not return other users' conversations", async () => {
		const { locals: localsA } = await createTestUser();
		const { locals: localsB } = await createTestUser();

		await createTestConversation(localsA, { title: "User A Chat" });
		await createTestConversation(localsB, { title: "User B Chat" });

		const res = await testRequest(GET, { path: conversationsPath(), locals: localsA });

		const data = await parseResponse<{ conversations: Array<{ title: string }> }>(res);
		expect(data.conversations).toHaveLength(1);
		expect(data.conversations[0].title).toBe("User A Chat");
	});

	it("scopes results to the session resolved from a real cookie", async () => {
		const { locals, cookie } = await createTestUser();
		await createTestConversation(locals, { title: "Cookie Chat" });
		const { locals: other } = await createTestUser();
		await createTestConversation(other, { title: "Someone Else" });

		const res = await testRequest(GET, { path: conversationsPath(), headers: { cookie } });

		const data = await parseResponse<{ conversations: Array<{ title: string }> }>(res);
		expect(data.conversations).toHaveLength(1);
		expect(data.conversations[0].title).toBe("Cookie Chat");
	});
});

describe.sequential("DELETE /api/v2/conversations", () => {
	afterEach(async () => {
		await cleanupTestData();
	});

	it("removes all conversations for authenticated user", async () => {
		const { locals } = await createTestUser();

		await createTestConversation(locals, { title: "Chat 1" });
		await createTestConversation(locals, { title: "Chat 2" });
		await createTestConversation(locals, { title: "Chat 3" });

		const res = await testRequest(DELETE, {
			path: conversationsPath(),
			method: "DELETE",
			locals,
		});
		expect(res.status).toBe(200);

		const data = await parseResponse<number>(res);
		expect(data).toBe(3);

		const remaining = await collections.conversations.countDocuments();
		expect(remaining).toBe(0);
	});

	it("returns 401 for unauthenticated request", async () => {
		const locals = createTestLocals({ sessionId: undefined, user: undefined });

		const res = await testRequest(DELETE, {
			path: conversationsPath(),
			method: "DELETE",
			locals,
		});

		expect(res.status).toBe(401);
	});

	it("does not remove other users' conversations", async () => {
		const { locals: localsA } = await createTestUser();
		const { locals: localsB } = await createTestUser();

		await createTestConversation(localsA, { title: "User A Chat" });
		await createTestConversation(localsB, { title: "User B Chat" });

		const res = await testRequest(DELETE, {
			path: conversationsPath(),
			method: "DELETE",
			locals: localsA,
		});
		const data = await parseResponse<number>(res);
		expect(data).toBe(1);

		const remaining = await collections.conversations.countDocuments();
		expect(remaining).toBe(1);

		const userBConvs = await collections.conversations
			.find({ userId: localsB.user?._id })
			.toArray();
		expect(userBConvs).toHaveLength(1);
		expect(userBConvs[0].title).toBe("User B Chat");
	});
});
