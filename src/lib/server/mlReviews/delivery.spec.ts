import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { createReview } from "./store";

const route = vi.hoisted(() => ({
	addresses: [] as string[],
	refuseWith: undefined as number | undefined,
}));

vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));
vi.mock("$lib/server/generation/parkedSweeper", () => ({
	rebuildIdentity: async () => ({ locals: {}, settings: null, tokenExpired: false }),
}));
// stands in for the route: records the rate limit address, saves the message and registers a run
vi.mock("$lib/server/generation/conversationRequest", () => ({
	generateConversationResponse: async ({
		request,
		params,
		getClientAddress,
	}: {
		request: Request;
		params: { id: string };
		getClientAddress: () => string;
	}) => {
		route.addresses.push(getClientAddress());
		if (route.refuseWith) error(route.refuseWith, "refused");
		const body = JSON.parse(String((await request.formData()).get("data")));
		const conversationId = new ObjectId(params.id);
		const userId = crypto.randomUUID();
		await collections.conversations.updateOne({ _id: conversationId }, {
			$push: {
				messages: {
					$each: [
						{ id: userId, from: "user", content: body.inputs, children: [`${userId}-reply`] },
						{ id: `${userId}-reply`, from: "assistant", content: "" },
					],
				},
			},
		} as never);
		await collections.generations.insertOne({
			_id: new ObjectId(),
			generationId: body.generationId,
			conversationId,
			messageId: `${userId}-reply`,
			status: "done",
			seq: 0,
			lastHeartbeatAt: new Date(),
			startedAt: new Date(),
			createdAt: new Date(),
			updatedAt: new Date(),
		} as never);
		return new Response("");
	},
}));

const { deliverReview, sweepReviewDeliveries } = await import("./delivery");

async function detachedSubmission(owner: { userId?: ObjectId; sessionId?: string }) {
	const conversationId = new ObjectId();
	await collections.conversations.insertOne({
		_id: conversationId,
		...owner,
		model: "m",
		title: "t",
		mlAssistant: true,
		messages: [{ id: "root", from: "system", content: "" }],
		createdAt: new Date(),
		updatedAt: new Date(),
	} as never);
	const review = await createReview({
		conversationId,
		messageId: "parked",
		toolCallId: "c",
		toolUuid: "u",
		elicitationId: crypto.randomUUID(),
		schema: {
			title: "Batch",
			idField: "id",
			fields: [{ name: "body", type: "text" }],
			questions: [],
			suggestions: "shown",
		},
		schemaHash: "abcd1234",
		source: { kind: "inline" },
		records: [{ id: "a", values: {} }],
	});
	await collections.mlReviews.updateOne(
		{ _id: review._id },
		{
			$set: {
				status: "submitted",
				submittedAt: new Date(),
				result: { text: `Review "Batch" submitted (${conversationId.toString()}).`, files: [] },
				delivery: { status: "pending", attempts: 0 },
			},
		}
	);
	return review._id;
}

const deliveryOf = async (reviewId: ObjectId) =>
	(await collections.mlReviews.findOne({ _id: reviewId }))?.delivery;

beforeAll(async () => {
	await ready;
});

beforeEach(() => {
	route.addresses.length = 0;
	route.refuseWith = undefined;
});

afterEach(async () => {
	await Promise.all([
		collections.mlReviews.deleteMany({}),
		collections.conversations.deleteMany({}),
		collections.generations.deleteMany({}),
		collections.semaphores.deleteMany({}),
	]);
});

describe("review delivery rate limits", () => {
	it("counts each owner's deliveries in their own bucket", async () => {
		const alice = new ObjectId();
		const first = await detachedSubmission({ userId: alice });
		const second = await detachedSubmission({ sessionId: "bob-session" });

		expect(await deliverReview(first)).toBe("sent");
		expect(await deliverReview(second)).toBe("sent");

		expect(route.addresses).toEqual([`review:${alice.toString()}`, "review:bob-session"]);
	});

	it("waits out a rate limit without spending an attempt, then posts", async () => {
		const reviewId = await detachedSubmission({ userId: new ObjectId() });
		route.refuseWith = 429;

		expect(await deliverReview(reviewId)).toBe("queued");
		const waiting = await deliveryOf(reviewId);
		expect(waiting).toMatchObject({ status: "pending", attempts: 0, error: "rate limited" });
		expect(waiting?.notBefore?.getTime()).toBeGreaterThan(Date.now() + 50_000);

		route.refuseWith = undefined;
		await sweepReviewDeliveries();
		expect(route.addresses).toHaveLength(1);
		expect(await deliverReview(reviewId)).toBe("queued");
		expect(route.addresses).toHaveLength(1);

		await collections.mlReviews.updateOne(
			{ _id: reviewId },
			{ $set: { "delivery.notBefore": new Date(Date.now() - 1_000) } }
		);
		await sweepReviewDeliveries();
		expect(route.addresses).toHaveLength(2);
		expect(await deliveryOf(reviewId)).toMatchObject({ status: "sent", attempts: 1 });
	});

	it("never fails a delivery for rate limits alone", async () => {
		const reviewId = await detachedSubmission({ userId: new ObjectId() });
		route.refuseWith = 429;
		for (let i = 0; i < 8; i += 1) {
			await collections.mlReviews.updateOne(
				{ _id: reviewId },
				{ $unset: { "delivery.notBefore": "" } }
			);
			expect(await deliverReview(reviewId)).toBe("queued");
		}
		expect(await deliveryOf(reviewId)).toMatchObject({ status: "pending", attempts: 0 });
	});
});
