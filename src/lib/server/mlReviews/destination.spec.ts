import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parquetReadObjects } from "hyparquet";
import { collections, ready } from "$lib/server/database";
import { ML_FILE_VERSION_INDEX } from "$lib/server/mlFiles/indexes";
import type { MlReview, ReviewSchema } from "$lib/types/MlReview";
import {
	cleanupTestData,
	createTestConversation,
	createTestUser,
} from "$lib/server/api/__tests__/testHelpers";

vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));
vi.mock("@huggingface/hub", async (importOriginal) => ({
	...(await importOriginal<typeof import("@huggingface/hub")>()),
	commit: vi.fn(),
	createRepo: vi.fn(async () => ({ repoUrl: "" })),
	fileExists: vi.fn(async () => false),
	datasetInfo: vi.fn(async () => ({ sha: "head1" })),
}));

const hub = await import("@huggingface/hub");
const { HubApiError } = hub;
const { besidePath, labelsParquet, parseDestination, pushReviewLabels, sourceRef } =
	await import("./destination");
const { ensureReviewResult, reviewResolvedUpdate } = await import("./result");
const { createReview } = await import("./store");
const { deliverReview } = await import("./delivery");

const SCHEMA: ReviewSchema = {
	title: "Sentiment gold",
	idField: "id",
	fields: [
		{ name: "text", type: "text", column: "Text" },
		{ name: "image", type: "image" },
	],
	questions: [
		{
			name: "sentiment",
			type: "label",
			required: true,
			options: [{ value: "pos" }, { value: "neg" }],
		},
		{
			name: "tags",
			type: "multi_label",
			required: false,
			options: [{ value: "a" }, { value: "b" }],
		},
		{ name: "quality", type: "rating", required: false, min: 1, max: 5 },
		{ name: "text_label", type: "boolean", required: false },
	],
	suggestions: "after_answer",
};

async function seed(overrides: Partial<MlReview> = {}): Promise<MlReview> {
	const { locals } = await createTestUser();
	const conv = await createTestConversation(locals, { mlAssistant: true });
	const review = await createReview({
		conversationId: conv._id,
		messageId: "msg-1",
		toolCallId: "call-1",
		toolUuid: "uuid-1",
		elicitationId: crypto.randomUUID(),
		schema: SCHEMA,
		schemaHash: "ab12cd34",
		source: {
			kind: "dataset",
			repo: "org/set",
			config: "default",
			split: "train",
			revision: "c0ffee",
			via: "viewer",
			sample: { method: "random", rows: 2, total: 1000, seed: 4, windows: 2 },
		},
		records: [
			{ id: "17", values: { text: "good" }, origin: { row: 17 }, media: ["image"] },
			{ id: "803", values: { text: "bad" }, origin: { row: 803 }, media: ["image"] },
		],
		destination: { repo: "pngwn/gold", type: "dataset", path: "data/batch-1.parquet", pr: false },
	});
	const submitted: MlReview = {
		...review,
		status: "submitted",
		verdict: "approve",
		publish: { decision: "push" },
		submittedAt: new Date("2026-10-20T12:00:00Z"),
		drafts: {
			"0": {
				status: "answered",
				answers: { sentiment: "pos", tags: ["a", "b"], quality: 4, text_label: true },
				comments: [{ id: "c1", field: "text", body: "short", createdAt: new Date() }],
				updatedAt: new Date(),
			},
			"1": { status: "skipped", answers: {}, comments: [], updatedAt: new Date() },
		},
		...overrides,
	};
	await collections.mlReviews.replaceOne({ _id: review._id }, submitted);
	return submitted;
}

const commitOutput = (pullRequestUrl?: string) => ({
	commit: { oid: "abc123", url: "https://huggingface.co/datasets/pngwn/gold/commit/abc123" },
	hookOutput: "",
	...(pullRequestUrl ? { pullRequestUrl } : {}),
});

const denied = (status: number) => new HubApiError("https://huggingface.co/api/x", status);

beforeAll(async () => {
	await ready;
	await collections.mlFiles.createIndex(ML_FILE_VERSION_INDEX.keys, ML_FILE_VERSION_INDEX.options);
});

beforeEach(() => {
	vi.mocked(hub.commit).mockReset();
	vi.mocked(hub.fileExists).mockReset();
	vi.mocked(hub.fileExists).mockResolvedValue(false);
	vi.mocked(hub.createRepo).mockClear();
	vi.mocked(hub.datasetInfo).mockReset();
	vi.mocked(hub.datasetInfo).mockResolvedValue({ sha: "head1" } as never);
});

afterEach(async () => {
	await cleanupTestData();
	await collections.mlReviews.deleteMany({});
});

describe("review destinations", () => {
	it("defaults the type and path, and refuses paths that leave the repo", () => {
		expect(parseDestination({ repo: "datasets/pngwn/gold" }, "data/x.parquet")).toEqual({
			repo: "pngwn/gold",
			type: "dataset",
			path: "data/x.parquet",
			pr: false,
		});
		for (const path of ["/abs.parquet", "../up.parquet", "a/../../b.parquet", "data.csv"]) {
			expect(parseDestination({ repo: "a/b", path }, "x.parquet")).toMatchObject({
				error: expect.stringContaining("path"),
			});
		}
		expect(parseDestination({ repo: "a/b", type: "bucket", pr: true }, "x.parquet")).toMatchObject({
			error: expect.stringContaining("bucket has no pull requests"),
		});
		expect(parseDestination({ repo: "nope" }, "x.parquet")).toMatchObject({
			error: expect.stringContaining("owner/name"),
		});
	});

	it("writes the reviewed columns, one per question and where each row came from", async () => {
		const review = await seed();
		const rows = await parquetReadObjects({ file: labelsParquet(review, "pngwn") });
		expect(Object.keys(rows[0])).toEqual([
			"id",
			"Text",
			"sentiment",
			"tags",
			"quality",
			"text_label",
			"review_status",
			"review_comments",
			"source_ref",
			"schema_hash",
			"reviewed_by",
			"reviewed_at",
		]);
		expect(rows[0]).toMatchObject({
			id: "17",
			Text: "good",
			sentiment: "pos",
			tags: ["a", "b"],
			quality: 4,
			text_label: true,
			review_status: "answered",
			review_comments: [{ field: "text", body: "short" }],
			source_ref: "hf://datasets/org/set@c0ffee?config=default&split=train&row=17",
			schema_hash: "ab12cd34",
			reviewed_by: "pngwn",
		});
		expect(rows[1]).toMatchObject({ sentiment: null, tags: null, review_status: "skipped" });
		expect(new Date(rows[0].reviewed_at as Date).toISOString()).toBe("2026-10-20T12:00:00.000Z");
	});

	it("points Parquet rows at their file and row", () => {
		const ref = sourceRef(
			{
				source: {
					kind: "parquet",
					uri: "hf://buckets/org/b/data",
					files: ["data/a.parquet"],
					sample: { method: "head", rows: 1, total: 1 },
				},
			},
			{ id: "x", values: {}, origin: { row: 1200, file: "data/a.parquet", fileRow: 200 } },
			0
		);
		expect(ref).toBe("hf://buckets/org/b/data/a.parquet?row=200");
	});

	it("commits once with the submitting user's token and reuses the outcome", async () => {
		vi.mocked(hub.commit).mockResolvedValue(commitOutput());
		const review = await seed();

		const push = await pushReviewLabels(review, "hf_owner");
		expect(push).toMatchObject({
			status: "pushed",
			pr: false,
			path: "data/batch-1.parquet",
			commit: "abc123",
		});
		const call = vi.mocked(hub.commit).mock.calls[0][0];
		expect(call).toMatchObject({
			repo: { type: "dataset", name: "pngwn/gold" },
			accessToken: "hf_owner",
			operations: [{ operation: "addOrUpdate", path: "data/batch-1.parquet" }],
			parentCommit: "head1",
		});
		expect(call).not.toHaveProperty("isPullRequest");

		const stored = await collections.mlReviews.findOne({ _id: review._id });
		expect(await pushReviewLabels(stored as MlReview, "hf_owner")).toMatchObject({
			status: "pushed",
		});
		expect(await pushReviewLabels(review, "hf_owner")).toMatchObject({ status: "pushed" });
		expect(hub.commit).toHaveBeenCalledTimes(1);
	});

	it("pushes only on the user's decision, a pull request when they chose one", async () => {
		vi.mocked(hub.commit).mockResolvedValue(
			commitOutput("https://huggingface.co/datasets/pngwn/gold/discussions/4")
		);
		expect(await pushReviewLabels(await seed({ publish: {} }), "hf_owner")).toBeUndefined();
		expect(
			await pushReviewLabels(await seed({ publish: { decision: "skip" } }), "hf_owner")
		).toBeUndefined();
		expect(hub.commit).not.toHaveBeenCalled();
		const push = await pushReviewLabels(await seed({ publish: { decision: "pr" } }), "hf_owner");
		expect(push).toMatchObject({ status: "pushed", pr: true });
		expect(vi.mocked(hub.commit).mock.calls[0][0]).toMatchObject({ isPullRequest: true });
	});

	it("opens a pull request when the user cannot write to the repo", async () => {
		vi.mocked(hub.commit)
			.mockRejectedValueOnce(denied(403))
			.mockResolvedValueOnce(
				commitOutput("https://huggingface.co/datasets/pngwn/gold/discussions/3")
			);
		const push = await pushReviewLabels(await seed(), "hf_owner");
		expect(push).toMatchObject({
			status: "pushed",
			pr: true,
			url: "https://huggingface.co/datasets/pngwn/gold/discussions/3",
		});
		expect(vi.mocked(hub.commit).mock.calls[1][0]).toMatchObject({ isPullRequest: true });
	});

	it("writes beside a file that is already there, and creates a missing repo private", async () => {
		vi.mocked(hub.fileExists).mockResolvedValue(true);
		vi.mocked(hub.commit).mockRejectedValueOnce(denied(404)).mockResolvedValueOnce(commitOutput());
		const review = await seed();
		const push = await pushReviewLabels(review, "hf_owner");
		const path = besidePath("data/batch-1.parquet", review._id.toString());
		expect(path).toMatch(/^data\/batch-1-[0-9a-f]{8}\.parquet$/);
		expect(push).toMatchObject({ status: "pushed", path });
		expect(hub.createRepo).toHaveBeenCalledWith(
			expect.objectContaining({ repo: { type: "dataset", name: "pngwn/gold" }, private: true })
		);
	});

	it("never lets two reviews write one path: a commit made meanwhile sends it beside", async () => {
		vi.mocked(hub.datasetInfo)
			.mockResolvedValueOnce({ sha: "head1" } as never)
			.mockResolvedValueOnce({ sha: "head2" } as never);
		vi.mocked(hub.fileExists).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		vi.mocked(hub.commit).mockRejectedValueOnce(denied(412)).mockResolvedValueOnce(commitOutput());
		const review = await seed();
		const push = await pushReviewLabels(review, "hf_owner");
		const beside = besidePath("data/batch-1.parquet", review._id.toString());
		expect(push).toMatchObject({ status: "pushed", path: beside });
		expect(vi.mocked(hub.fileExists).mock.calls.map((c) => c[0].revision)).toEqual([
			"head1",
			"head2",
		]);
		expect(
			vi.mocked(hub.commit).mock.calls.map((c) => [c[0].parentCommit, c[0].operations[0].path])
		).toEqual([
			["head1", "data/batch-1.parquet"],
			["head2", beside],
		]);
	});

	it("waits out a commit still running on the repo, then checks the path again", async () => {
		vi.mocked(hub.commit).mockRejectedValueOnce(denied(409)).mockResolvedValueOnce(commitOutput());
		const push = await pushReviewLabels(await seed(), "hf_owner");
		expect(push).toMatchObject({ status: "pushed", path: "data/batch-1.parquet" });
		expect(hub.datasetInfo).toHaveBeenCalledTimes(2);
		expect(hub.commit).toHaveBeenCalledTimes(2);
	});

	it("gives a bucket file a review specific path, a bucket write cannot be conditional", async () => {
		vi.mocked(hub.commit).mockResolvedValue(commitOutput());
		const review = await seed({
			destination: { repo: "org/bucket", type: "bucket", path: "labels.parquet", pr: false },
		});
		const push = await pushReviewLabels(review, "hf_owner");
		expect(push).toMatchObject({
			status: "pushed",
			path: besidePath("labels.parquet", review._id.toString()),
		});
		expect(hub.fileExists).not.toHaveBeenCalled();
	});

	it("waits for a repo it just created to accept writes", async () => {
		vi.mocked(hub.commit)
			.mockRejectedValueOnce(denied(404))
			.mockRejectedValueOnce(denied(404))
			.mockResolvedValueOnce(commitOutput());
		const push = await pushReviewLabels(
			await seed({
				destination: { repo: "pngwn/new", type: "bucket", path: "a.parquet", pr: false },
			}),
			"hf_owner"
		);
		expect(push).toMatchObject({ status: "pushed" });
		expect(hub.createRepo).toHaveBeenCalledTimes(1);
		expect(hub.commit).toHaveBeenCalledTimes(3);
	});

	it("reports, never repeats, a push a dead process left half done", async () => {
		const review = await seed({
			push: { status: "pushing", takenAt: new Date(Date.now() - 600_000) },
		});
		const push = await pushReviewLabels(review, "hf_owner");
		expect(push).toMatchObject({
			status: "failed",
			error: expect.stringContaining("may or may not have landed"),
		});
		expect(hub.commit).not.toHaveBeenCalled();
	});

	it("fails without a sign in rather than pushing as anyone else", async () => {
		const review = await seed();
		await collections.sessions.deleteMany({});
		const push = await pushReviewLabels(review);
		expect(push).toMatchObject({ status: "failed", error: expect.stringContaining("sign in") });
		expect(hub.commit).not.toHaveBeenCalled();
	});

	it("puts the push in the tool result and the resolved card", async () => {
		vi.mocked(hub.commit).mockResolvedValue(commitOutput());
		const review = await seed();
		const result = await ensureReviewResult(review, "hf_owner");
		expect(result.text).toContain(
			"Labels pushed to pngwn/gold (data/batch-1.parquet): https://huggingface.co/datasets/pngwn/gold/commit/abc123"
		);
		expect(result.text).toContain(
			"Source: 2 of 1,000 rows of org/set default/train, read through the dataset viewer at c0ffee, a random sample, seed 4, in 2 windows."
		);
		expect(result.pushed).toEqual({
			url: "https://huggingface.co/datasets/pngwn/gold/commit/abc123",
			pr: false,
			path: "data/batch-1.parquet",
		});
		expect(reviewResolvedUpdate({ ...review, result }).pushed).toEqual({
			url: "https://huggingface.co/datasets/pngwn/gold/commit/abc123",
			pr: false,
		});
	});

	it("builds a detached review's result, push included, before its delivery posts it", async () => {
		vi.mocked(hub.commit).mockResolvedValue(commitOutput());
		const review = await seed({ delivery: { status: "pending", attempts: 0 } });
		const conv = await collections.conversations.findOne({ _id: review.conversationId });
		await collections.sessions.updateOne(
			{ userId: conv?.userId },
			{ $set: { oauth: { token: { value: "hf_owner" } } } as never }
		);
		await collections.generations.insertOne({
			conversationId: review.conversationId,
			status: "running",
		} as never);

		expect(await deliverReview(review._id)).toBe("queued");
		const stored = await collections.mlReviews.findOne({ _id: review._id });
		expect(stored?.result?.text).toContain("Labels pushed to pngwn/gold (data/batch-1.parquet)");
		expect(stored?.delivery?.status).toBe("pending");
		expect(vi.mocked(hub.commit).mock.calls[0][0]).toMatchObject({ accessToken: "hf_owner" });
		await collections.generations.deleteMany({ conversationId: review.conversationId });
	});

	it("tells the model when the push failed, and still answers", async () => {
		vi.mocked(hub.commit).mockRejectedValue(denied(403));
		const review = await seed({
			destination: { repo: "org/bucket", type: "bucket", path: "labels.parquet", pr: false },
		});
		const result = await ensureReviewResult(review, "hf_owner");
		expect(result.text).toContain(
			"Labels were NOT pushed to org/bucket (labels.parquet): the signed in user cannot write to org/bucket."
		);
		expect(result.pushed).toBeUndefined();
	});
});
