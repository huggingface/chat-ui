import { describe, expect, it, afterEach, beforeAll } from "vitest";
import { ObjectId } from "mongodb";
import superjson from "superjson";
import { collections, ready } from "$lib/server/database";
import {
	createTestLocals,
	createTestUser,
	createTestConversation,
	cleanupTestData,
} from "./testHelpers";

import { GET, DELETE, PATCH } from "../../../../routes/api/v2/conversations/[id]/+server";

async function parseResponse<T = unknown>(res: Response): Promise<T> {
	return superjson.parse(await res.text()) as T;
}

function mockUrl(): URL {
	return new URL("http://localhost:5173/api/v2/conversations/some-id");
}

// `collections` is undefined until the database IIFE resolves.
beforeAll(async () => {
	await ready;
});

describe.sequential("GET /api/v2/conversations/[id]", () => {
	afterEach(async () => {
		await cleanupTestData();
	});

	it("returns conversation data for owner", { timeout: 15000 }, async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, {
			title: "My Conversation",
			model: "test-model",
			preprompt: "You are helpful.",
		});

		const res = await GET({
			locals,
			params: { id: conv._id.toString() },
			url: mockUrl(),
		} as never);

		expect(res.status).toBe(200);
		const data = await parseResponse<{
			title: string;
			model: string;
			preprompt: string;
			id: string;
		}>(res);
		expect(data.title).toBe("My Conversation");
		expect(data.model).toBe("test-model");
		expect(data.preprompt).toBe("You are helpful.");
		expect(data.id).toBe(conv._id.toString());
	});

	it("throws 404 for non-existent conversation", async () => {
		const { locals } = await createTestUser();
		const fakeId = new ObjectId().toString();

		try {
			await GET({
				locals,
				params: { id: fakeId },
				url: mockUrl(),
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(404);
		}
	});

	it("throws 403 for another user's conversation", async () => {
		const { locals: localsA } = await createTestUser();
		const { locals: localsB } = await createTestUser();
		const conv = await createTestConversation(localsA, { title: "Private Chat" });

		try {
			await GET({
				locals: localsB,
				params: { id: conv._id.toString() },
				url: mockUrl(),
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(403);
		}
	});

	it("throws 401 for unauthenticated request", async () => {
		const locals = createTestLocals({ sessionId: undefined, user: undefined });

		try {
			await GET({
				locals,
				params: { id: new ObjectId().toString() },
				url: mockUrl(),
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(401);
		}
	});

	it("throws 400 for invalid ObjectId format", async () => {
		const { locals } = await createTestUser();

		try {
			await GET({
				locals,
				params: { id: "not-a-valid-objectid" },
				url: mockUrl(),
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(400);
		}
	});
});

describe.sequential("DELETE /api/v2/conversations/[id]", () => {
	afterEach(async () => {
		await cleanupTestData();
	});

	it("removes owned conversation", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { title: "To Delete" });

		const res = await DELETE({
			locals,
			params: { id: conv._id.toString() },
		} as never);

		expect(res.status).toBe(200);
		const data = await parseResponse<{ success: boolean }>(res);
		expect(data.success).toBe(true);

		const found = await collections.conversations.findOne({ _id: conv._id });
		expect(found).toBeNull();
	});

	it("throws 404 for non-existent conversation", async () => {
		const { locals } = await createTestUser();
		const fakeId = new ObjectId().toString();

		try {
			await DELETE({
				locals,
				params: { id: fakeId },
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(404);
		}
	});

	it("throws 401 for unauthenticated request", async () => {
		const locals = createTestLocals({ sessionId: undefined, user: undefined });

		try {
			await DELETE({
				locals,
				params: { id: new ObjectId().toString() },
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(401);
		}
	});
});

describe.sequential("PATCH /api/v2/conversations/[id]", () => {
	afterEach(async () => {
		await cleanupTestData();
	});

	it("updates title", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { title: "Old Title" });

		const res = await PATCH({
			locals,
			params: { id: conv._id.toString() },
			request: new Request("http://localhost", {
				method: "PATCH",
				body: JSON.stringify({ title: "New Title" }),
				headers: { "Content-Type": "application/json" },
			}),
		} as never);

		expect(res.status).toBe(200);
		const data = await parseResponse<{ success: boolean }>(res);
		expect(data.success).toBe(true);

		const updated = await collections.conversations.findOne({ _id: conv._id });
		expect(updated?.title).toBe("New Title");
	});

	it("strips <think> tags from title", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { title: "Old Title" });

		const res = await PATCH({
			locals,
			params: { id: conv._id.toString() },
			request: new Request("http://localhost", {
				method: "PATCH",
				body: JSON.stringify({ title: "<think>hidden</think>Visible Title" }),
				headers: { "Content-Type": "application/json" },
			}),
		} as never);

		expect(res.status).toBe(200);

		const updated = await collections.conversations.findOne({ _id: conv._id });
		expect(updated?.title).toBe("hiddenVisible Title");
	});

	it("rejects empty title", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { title: "Original" });

		try {
			await PATCH({
				locals,
				params: { id: conv._id.toString() },
				request: new Request("http://localhost", {
					method: "PATCH",
					body: JSON.stringify({ title: "" }),
					headers: { "Content-Type": "application/json" },
				}),
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(400);
		}
	});

	it("rejects title longer than 100 characters", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { title: "Original" });
		const longTitle = "a".repeat(101);

		try {
			await PATCH({
				locals,
				params: { id: conv._id.toString() },
				request: new Request("http://localhost", {
					method: "PATCH",
					body: JSON.stringify({ title: longTitle }),
					headers: { "Content-Type": "application/json" },
				}),
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(400);
		}
	});

	it("throws 404 for non-existent conversation", async () => {
		const { locals } = await createTestUser();
		const fakeId = new ObjectId().toString();

		try {
			await PATCH({
				locals,
				params: { id: fakeId },
				request: new Request("http://localhost", {
					method: "PATCH",
					body: JSON.stringify({ title: "New Title" }),
					headers: { "Content-Type": "application/json" },
				}),
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(404);
		}
	});

	it("throws 401 for unauthenticated request", async () => {
		const locals = createTestLocals({ sessionId: undefined, user: undefined });

		try {
			await PATCH({
				locals,
				params: { id: new ObjectId().toString() },
				request: new Request("http://localhost", {
					method: "PATCH",
					body: JSON.stringify({ title: "New Title" }),
					headers: { "Content-Type": "application/json" },
				}),
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(401);
		}
	});
});

describe.sequential("PATCH /api/v2/conversations/[id] mlBudgetLeftUsd", () => {
	afterEach(async () => {
		await cleanupTestData();
	});

	const patchLeft = (locals: App.Locals, id: ObjectId, body: Record<string, unknown>) =>
		PATCH({
			locals,
			params: { id: id.toString() },
			request: new Request("http://localhost", {
				method: "PATCH",
				body: JSON.stringify(body),
				headers: { "Content-Type": "application/json" },
			}),
		} as never);

	const ledger = {
		totalMicroUsd: 1_000_000,
		spentMicroUsd: 4_321,
		reservations: [
			{
				key: "g:c1",
				kind: "job" as const,
				flavor: "cpu-basic",
				priceMicroUsdPerMinute: 20_000,
				timeoutSeconds: 600,
				ceilingMicroUsd: 200_000,
				createdAt: new Date(),
			},
		],
	};

	it("sets the total to left plus the live spent and held", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, {
			mlAssistant: true,
			mlBudget: ledger,
		} as never);

		const res = await patchLeft(locals, conv._id, { mlBudgetLeftUsd: 0 });

		expect(res.status).toBe(200);
		const data = await parseResponse<{
			mlBudget: { totalMicroUsd: number; spentMicroUsd: number; reservedMicroUsd: number };
		}>(res);
		// Zero left lands on exactly zero, sub-cent spend included.
		expect(data.mlBudget).toEqual({
			totalMicroUsd: 204_321,
			spentMicroUsd: 4_321,
			reservedMicroUsd: 200_000,
		});
		const stored = await collections.conversations.findOne({ _id: conv._id });
		expect(stored?.mlBudget?.totalMicroUsd).toBe(204_321);
		expect(stored?.mlBudget?.reservations).toHaveLength(1);
	});

	it("rejects a total that would pass the ceiling once committed money is added", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, {
			mlAssistant: true,
			mlBudget: ledger,
		} as never);

		await expect(patchLeft(locals, conv._id, { mlBudgetLeftUsd: 10_000 })).rejects.toMatchObject({
			status: 400,
		});
		const stored = await collections.conversations.findOne({ _id: conv._id });
		expect(stored?.mlBudget?.totalMicroUsd).toBe(1_000_000);
	});

	it("will not conjure a budget onto an ordinary conversation", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals);

		await expect(patchLeft(locals, conv._id, { mlBudgetLeftUsd: 5 })).rejects.toMatchObject({
			status: 404,
		});
	});

	it("rejects setting both the total and what is left", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true } as never);

		await expect(
			patchLeft(locals, conv._id, { mlBudgetLeftUsd: 1, mlBudgetTotalUsd: 1 })
		).rejects.toMatchObject({ status: 400 });
	});
});
