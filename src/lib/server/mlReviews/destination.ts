import {
	commit,
	createRepo,
	datasetInfo,
	fileExists,
	HubApiError,
	type RepoDesignation,
} from "@huggingface/hub";
import { parquetWriteBuffer } from "hyparquet-writer";
import type { ColumnSource } from "hyparquet-writer";
import type { ObjectId } from "mongodb";
import { z } from "zod";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import type {
	MlReview,
	ReviewDestination,
	ReviewPush,
	ReviewQuestion,
	ReviewRecord,
} from "$lib/types/MlReview";
import { isAnswered, recordStatus } from "$lib/utils/review/answers";
import { columnOf, isMediaType } from "./features";

/** a push quiet this long is reported failed, never retried, as its commit may have landed */
export const PUSH_LEASE_MS = 5 * 60 * 1000;
const PUSH_POLL_MS = 2_000;

export const destinationSchema = z.object({
	repo: z
		.string()
		.trim()
		.transform((repo) => repo.replace(/^(datasets|buckets)\//, ""))
		.pipe(z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'repo must be "owner/name"')),
	type: z.enum(["dataset", "bucket"]).default("dataset"),
	path: z
		.string()
		.trim()
		.max(200)
		.regex(
			/^(?!\/)(?!.*(^|\/)\.\.?(\/|$))[\w./ -]+\.parquet$/,
			"path must be a relative path ending in .parquet"
		)
		.optional(),
	pr: z.boolean().default(false),
});

export function parseDestination(
	value: unknown,
	fallbackPath: string
): ReviewDestination | { error: string } {
	const parsed = destinationSchema.safeParse(value);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return {
			error: `destination.${issue?.path.join(".") || "repo"}: ${issue?.message ?? "invalid"}`,
		};
	}
	const { repo, type, path, pr } = parsed.data;
	if (type === "bucket" && pr) return { error: "destination.pr: a bucket has no pull requests" };
	return { repo, type, path: path ?? fallbackPath, pr };
}

export const sameDestination = (a: ReviewDestination, b: ReviewDestination) =>
	a.repo === b.repo && a.type === b.type && a.path === b.path && a.pr === b.pr;

export const destinationUrl = (d: Pick<ReviewDestination, "repo" | "type">) =>
	`https://huggingface.co/${d.type === "bucket" ? "buckets" : "datasets"}/${d.repo}`;

export function sourceRef(
	review: Pick<MlReview, "source">,
	record: ReviewRecord,
	index: number
): string {
	const source = review.source;
	const row = record.origin?.row ?? index;
	switch (source.kind) {
		case "dataset": {
			const at = source.revision ? `@${encodeURIComponent(source.revision)}` : "";
			const file = record.origin?.file;
			const where =
				record.origin?.byte !== undefined && record.origin.fileRow === undefined
					? `byte=${record.origin.byte}`
					: `row=${record.origin?.fileRow ?? row}`;
			return file
				? `hf://datasets/${source.repo}${at}/${file}?${where}`
				: `hf://datasets/${source.repo}${at}?config=${encodeURIComponent(source.config)}&split=${encodeURIComponent(source.split)}&row=${row}`;
		}
		case "parquet": {
			const base = source.uri.replace(/\/[^/]*\.parquet$/, "").replace(/\/+$/, "");
			const file = record.origin?.file;
			if (!file) return `${source.uri}?row=${row}`;
			const repoRoot = /^hf:\/\/(datasets|buckets)\/[^/]+\/[^/]+/.exec(base)?.[0] ?? base;
			return `${repoRoot}/${file}?row=${record.origin?.fileRow ?? row}`;
		}
		case "hub":
			return `${source.uri}?row=${index}`;
		case "file":
			return `v-file://${source.name}@v${source.version}?row=${index}`;
		case "sandbox":
			return `sandbox://${source.handle}${source.path}?row=${index}`;
		case "inline":
			return `inline?row=${index}`;
	}
}

function answerColumn(question: ReviewQuestion, name: string, values: unknown[]): ColumnSource {
	switch (question.type) {
		case "multi_label":
			return { name, data: values, type: "JSON", nullable: true };
		case "rating":
			return { name, data: values, type: "INT32", nullable: true };
		case "boolean":
			return { name, data: values, type: "BOOLEAN", nullable: true };
		default:
			return { name, data: values, type: "STRING", nullable: true };
	}
}

export const REVIEW_COLUMNS = [
	"review_status",
	"review_comments",
	"source_ref",
	"schema_hash",
	"reviewed_by",
	"reviewed_at",
] as const;

export function labelsParquet(review: MlReview, reviewedBy: string): ArrayBuffer {
	const records = review.records;
	const draft = (i: number) => review.drafts[String(i)];
	const columns: ColumnSource[] = [];
	const taken = new Set<string>();
	const add = (column: ColumnSource) => {
		taken.add(column.name);
		columns.push(column);
	};

	// a file pushed by an earlier review carries these, the answers of this one replace them
	const replaced = new Set<string>([
		...REVIEW_COLUMNS,
		...review.schema.questions.flatMap((q) => [q.name, `${q.name}_label`]),
	]);
	add({ name: review.schema.idField, data: records.map((r) => r.id), type: "STRING" });
	for (const field of review.schema.fields) {
		// media stays where it is, source_ref joins back to it
		if (isMediaType(field.type) && records.some((r) => r.media?.includes(field.name))) continue;
		const name = columnOf(field);
		if (taken.has(name) || replaced.has(name)) continue;
		const values = records.map((r) => r.values[field.name] ?? null);
		const type =
			field.type === "number"
				? "DOUBLE"
				: field.type === "json" || field.type === "chat"
					? "JSON"
					: values.every((v) => v === null || typeof v === "string")
						? "STRING"
						: "JSON";
		add({ name, data: values, type, nullable: true });
	}
	for (const question of review.schema.questions) {
		const name = taken.has(question.name) ? `${question.name}_label` : question.name;
		const values = records.map((_, i) => {
			const value = draft(i)?.answers?.[question.name];
			return isAnswered(value) ? value : null;
		});
		add(answerColumn(question, name, values));
	}
	const reviewedAt = review.submittedAt ?? new Date();
	add({
		name: "review_status",
		data: records.map((_, i) => recordStatus(review.schema, draft(i))),
		type: "STRING",
	});
	add({
		name: "review_comments",
		data: records.map((_, i) =>
			(draft(i)?.comments ?? []).map((c) => ({
				...(c.field ? { field: c.field } : {}),
				...(c.quote ? { quote: c.quote.exact } : {}),
				...(c.area ? { area: c.area } : {}),
				...(c.time ? { time: c.time } : {}),
				body: c.body,
			}))
		),
		type: "JSON",
	});
	add({ name: "source_ref", data: records.map((r, i) => sourceRef(review, r, i)), type: "STRING" });
	add({ name: "schema_hash", data: records.map(() => review.schemaHash), type: "STRING" });
	add({ name: "reviewed_by", data: records.map(() => reviewedBy), type: "STRING" });
	add({ name: "reviewed_at", data: records.map(() => reviewedAt), type: "TIMESTAMP" });

	return parquetWriteBuffer({ columnData: columns });
}

/** the owner as last signed in, a resume or sweep has no request to read */
export async function ownerToken(conversationId: ObjectId): Promise<string | undefined> {
	const conv = await collections.conversations.findOne(
		{ _id: conversationId },
		{ projection: { userId: 1, sessionId: 1 } }
	);
	if (!conv) return undefined;
	// a static import pulls the generation stack into every importer of the review tool
	const { rebuildIdentity } = await import("$lib/server/generation/parkedSweeper");
	const { locals } = await rebuildIdentity({ userId: conv.userId, sessionId: conv.sessionId });
	return locals.token;
}

async function reviewerName(conversationId: ObjectId): Promise<string> {
	const conv = await collections.conversations.findOne(
		{ _id: conversationId },
		{ projection: { userId: 1 } }
	);
	const user = conv?.userId
		? await collections.users.findOne({ _id: conv.userId }, { projection: { username: 1 } })
		: null;
	return user?.username ?? "unknown";
}

const statusOf = (err: unknown) => (err instanceof HubApiError ? err.statusCode : undefined);

const CREATE_SETTLE_MS = [1_000, 2_000, 4_000];
/** a 409 means another commit to the repo is still running, the probe saw one take 30 s */
const COMMIT_RACE_WAITS_MS = [2_000, 4_000, 8_000, 16_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** a bucket created a moment ago still 404s its xet write token */
async function afterCreate<T>(write: () => Promise<T>): Promise<T> {
	for (const wait of CREATE_SETTLE_MS) {
		try {
			return await write();
		} catch (err) {
			if (statusOf(err) !== 404) throw err;
			await sleep(wait);
		}
	}
	return write();
}

/** a later batch to the same path lands beside the first */
export function besidePath(path: string, reviewId: string): string {
	return path.replace(/\.parquet$/, `-${reviewId.slice(-8)}.parquet`);
}

async function finishPush(review: Pick<MlReview, "_id">, push: ReviewPush): Promise<ReviewPush> {
	await collections.mlReviews.updateOne(
		{ _id: review._id, "push.status": "pushing", "push.takenAt": push.takenAt },
		{ $set: { push, updatedAt: new Date() } }
	);
	return push;
}

export async function pushReviewLabels(
	review: MlReview,
	token?: string
): Promise<ReviewPush | undefined> {
	const destination = review.destination;
	const decision = review.publish?.decision;
	// only the user choice on the publish card pushes
	if (!destination || (decision !== "push" && decision !== "pr")) return undefined;
	if (review.push && review.push.status !== "pushing") return review.push;

	const takenAt = new Date();
	const claimed = await collections.mlReviews.updateOne(
		{ _id: review._id, status: "submitted", push: { $exists: false } },
		{ $set: { push: { status: "pushing", takenAt }, updatedAt: takenAt } }
	);
	if (claimed.matchedCount === 0) {
		const current = await collections.mlReviews.findOne(
			{ _id: review._id },
			{ projection: { push: 1 } }
		);
		const push = current?.push;
		if (!push || push.status !== "pushing") return push;
		if (Date.now() - push.takenAt.getTime() < PUSH_LEASE_MS) return push;
		const lost: ReviewPush = {
			...push,
			status: "failed",
			error: interrupted(destination),
			finishedAt: new Date(),
		};
		return finishPush(review, lost);
	}

	const base: ReviewPush = { status: "pushing", takenAt };
	const fail = (error: string) =>
		finishPush(review, { ...base, status: "failed", error, finishedAt: new Date() });

	const accessToken = token ?? (await ownerToken(review.conversationId));
	if (!accessToken) return fail("there is no Hugging Face sign in to push with");

	const repo: RepoDesignation = { type: destination.type, name: destination.repo };
	let content: Blob;
	try {
		const bytes = labelsParquet(review, await reviewerName(review.conversationId));
		content = new Blob([bytes], { type: "application/vnd.apache.parquet" });
	} catch (err) {
		logger.error({ err, reviewId: review._id.toString() }, "[review] writing the labels failed");
		return fail("the labels could not be written as Parquet");
	}

	const reviewId = review._id.toString();
	const title = `Add review labels: ${review.schema.title}`.slice(0, 200);
	const description = `${review.records.length} rows reviewed in HuggingChat, schema ${review.schemaHash}.`;
	// a bucket has no commit to make the write conditional on, so its file is always review specific
	let path =
		destination.type === "bucket" ? besidePath(destination.path, reviewId) : destination.path;
	const commitTo = (isPullRequest: boolean, parentCommit?: string) =>
		commit({
			repo,
			accessToken,
			title,
			description,
			operations: [{ operation: "addOrUpdate", path, content }],
			...(isPullRequest ? { isPullRequest: true } : {}),
			...(parentCommit ? { parentCommit } : {}),
		});
	const pathAt = async (revision?: string) =>
		(await fileExists({
			repo,
			path: destination.path,
			accessToken,
			...(revision ? { revision } : {}),
		}))
			? besidePath(destination.path, reviewId)
			: destination.path;
	// checked and committed against one head, so a review that landed meanwhile 412s this one
	const direct = async () => {
		for (let attempt = 0; ; attempt += 1) {
			const { sha } = await datasetInfo({
				name: destination.repo,
				accessToken,
				additionalFields: ["sha"],
			});
			path = await pathAt(sha);
			try {
				return await commitTo(false, sha);
			} catch (err) {
				const status = statusOf(err);
				if ((status !== 409 && status !== 412) || attempt >= COMMIT_RACE_WAITS_MS.length) throw err;
				if (status === 409) await sleep(COMMIT_RACE_WAITS_MS[attempt]);
			}
		}
	};
	const write = async (isPullRequest: boolean) => {
		if (destination.type === "dataset" && !isPullRequest) return direct();
		if (destination.type === "dataset") path = await pathAt();
		return commitTo(isPullRequest);
	};

	let pr = destination.pr || decision === "pr";
	try {
		let output;
		try {
			output = await write(pr);
		} catch (err) {
			const status = statusOf(err);
			if (status === 404) {
				await createRepo({ repo, accessToken, private: true });
				output = await afterCreate(() => write(pr));
			} else if ((status === 401 || status === 403) && !pr && destination.type === "dataset") {
				pr = true;
				output = await write(true);
			} else {
				throw err;
			}
		}
		const fileUrl =
			destination.type === "bucket"
				? `${destinationUrl(destination)}/resolve/${path}`
				: `${destinationUrl(destination)}/blob/main/${path}`;
		return finishPush(review, {
			...base,
			status: "pushed",
			path,
			pr,
			url:
				output?.pullRequestUrl ??
				(pr ? destinationUrl(destination) : (output?.commit.url ?? fileUrl)),
			...(output?.commit.oid ? { commit: output.commit.oid } : {}),
			finishedAt: new Date(),
		});
	} catch (err) {
		const status = statusOf(err);
		logger.warn({ err, reviewId: review._id.toString(), status }, "[review] pushing labels failed");
		return fail(
			status === 401 || status === 403
				? `the signed in user cannot write to ${destination.repo}`
				: err instanceof Error
					? err.message
					: String(err)
		);
	}
}

const interrupted = (destination: Pick<ReviewDestination, "repo" | "type"> | undefined) =>
	`an earlier push was interrupted and may or may not have landed; check ${destination ? destinationUrl(destination) : "the destination"}`;

/** waits out a push another process holds until it settles or its lease lapses, a result never sees pushing */
export async function settledPush(
	review: MlReview,
	token?: string
): Promise<ReviewPush | undefined> {
	let push = await pushReviewLabels(review, token);
	const deadline = Date.now() + PUSH_LEASE_MS + PUSH_POLL_MS * 5;
	while (push?.status === "pushing" && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, PUSH_POLL_MS));
		push = await pushReviewLabels(
			(await collections.mlReviews.findOne({ _id: review._id })) ?? review,
			token
		);
	}
	if (push?.status === "pushing") {
		throw new Error(`the push for review ${review._id.toString()} did not settle`);
	}
	return push;
}

/** for the sweep, a push whose holder went quiet past its lease is failed, never left pushing */
export async function expireStalePushes(now = Date.now()): Promise<number> {
	const stale = await collections.mlReviews
		.find(
			{
				"push.status": "pushing",
				"push.takenAt": { $lt: new Date(now - PUSH_LEASE_MS) },
			},
			{ projection: { push: 1, destination: 1 } }
		)
		.limit(50)
		.toArray();
	let expired = 0;
	for (const review of stale) {
		if (!review.push) continue;
		const updated = await collections.mlReviews.updateOne(
			{ _id: review._id, "push.status": "pushing", "push.takenAt": review.push.takenAt },
			{
				$set: {
					"push.status": "failed",
					"push.error": interrupted(review.destination),
					"push.finishedAt": new Date(now),
					updatedAt: new Date(now),
				},
			}
		);
		expired += updated.modifiedCount;
	}
	return expired;
}
