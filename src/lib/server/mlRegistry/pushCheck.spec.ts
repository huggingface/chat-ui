import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import type { MlArtefact } from "$lib/types/MlArtefact";
import type { MlService } from "$lib/types/MlService";
import { checkServicePushes } from "./pushCheck";

beforeAll(async () => {
	await ready;
});

const conversationIds: ObjectId[] = [];

afterEach(async () => {
	vi.unstubAllGlobals();
	await collections.mlServices.deleteMany({ conversationId: { $in: conversationIds } });
	await collections.mlArtefacts.deleteMany({ conversationId: { $in: conversationIds } });
	conversationIds.length = 0;
});

const MINUTE = 60_000;
const SUBMITTED = new Date("2026-09-25T10:00:00Z");
const STARTED = new Date("2026-09-25T10:01:00Z");
const ENDED = new Date("2026-09-25T11:13:00Z");
const JOB_ID = "0123456789abcdef01234567";
const TOKEN = "hf_test";
const iso = (date: Date, offsetMs = 0) => new Date(date.getTime() + offsetMs).toISOString();
const sha = (seed: string) => seed.repeat(40).slice(0, 40);

type FakeRepo = {
	sha: string;
	lastModified: string;
	createdAt?: string;
	commits?: { id: string; date: string }[];
};
type FakeListed = FakeRepo & { id: string };

interface FakeHub {
	repos?: Record<string, FakeRepo>;
	listings?: Record<string, FakeListed[]>;
	hang?: boolean;
	status?: number;
}

function stubHub({ repos = {}, listings = {}, hang = false, status }: FakeHub = {}) {
	const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		if (hang) {
			return new Promise<Response>((_, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
			});
		}
		if (status) return new Response("{}", { status });
		const url = new URL(String(input));
		const path = url.pathname.replace(/^\/api\//, "");
		const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
		const listing = /^(models|datasets)$/.exec(path);
		if (listing) return json(listings[`${listing[1]}?${url.searchParams.get("author")}`] ?? []);
		const commits = /^(.+)\/commits\/main$/.exec(path);
		const repo = repos[commits ? commits[1] : path];
		if (!repo)
			return new Response(JSON.stringify({ error: "Repository not found" }), { status: 404 });
		return json(commits ? (repo.commits ?? []) : repo);
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

async function insertService(overrides: Partial<MlService> = {}): Promise<MlService> {
	const conversationId = overrides.conversationId ?? new ObjectId();
	if (!conversationIds.some((id) => id.equals(conversationId)))
		conversationIds.push(conversationId);
	const service: MlService = {
		_id: new ObjectId(),
		conversationId,
		kind: "job",
		jobId: JOB_ID,
		namespace: "testuser",
		name: "qwen-sft",
		stage: "RUNNING",
		origin: "dispatched",
		hubUrl: `https://huggingface.co/jobs/testuser/${JOB_ID}`,
		expectedPushes: [{ kind: "model", uri: "hf://models/testuser/qwen-sft" }],
		startedAt: STARTED,
		createdAt: SUBMITTED,
		updatedAt: SUBMITTED,
		...overrides,
	};
	await collections.mlServices.insertOne(service);
	return service;
}

async function insertArtefact(
	conversationId: ObjectId,
	overrides: Partial<MlArtefact> & { uri: string }
): Promise<MlArtefact> {
	const artefact: MlArtefact = {
		_id: new ObjectId(),
		conversationId,
		kind: "model",
		url: "https://huggingface.co/testuser/x",
		origin: "dispatched",
		createdAt: SUBMITTED,
		updatedAt: SUBMITTED,
		...overrides,
	};
	await collections.mlArtefacts.insertOne(artefact);
	return artefact;
}

const artefactAt = (conversationId: ObjectId, uri: string) =>
	collections.mlArtefacts.findOne({ conversationId, uri });

const check = (service: MlService, timeoutMs?: number) =>
	checkServicePushes({
		service,
		startedAt: STARTED,
		endedAt: ENDED,
		token: TOKEN,
		...(timeoutMs ? { timeoutMs } : {}),
	});

const RESERVED: FakeRepo = {
	sha: sha("0"),
	lastModified: iso(SUBMITTED, -MINUTE),
	createdAt: iso(SUBMITTED, -MINUTE),
};
const PUSHED_DURING_RUN: FakeRepo = {
	sha: sha("a"),
	lastModified: iso(ENDED, -2 * MINUTE),
	createdAt: iso(SUBMITTED, -MINUTE),
};

describe("checkServicePushes: expected destinations", () => {
	it("reports a push whose commit landed during the run, and links the reserved repo to the job", async () => {
		const service = await insertService();
		await insertArtefact(service.conversationId, { uri: "hf://models/testuser/qwen-sft" });
		const fetchMock = stubHub({ repos: { "models/testuser/qwen-sft": PUSHED_DURING_RUN } });

		expect(await check(service)).toEqual([
			{ uri: "hf://models/testuser/qwen-sft", status: "pushed", commit: sha("a") },
		]);
		const [repoRead] = fetchMock.mock.calls[0];
		expect(String(repoRead)).toContain("/api/models/testuser/qwen-sft?expand[]=sha");
		expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });

		const repo = await artefactAt(service.conversationId, "hf://models/testuser/qwen-sft");
		expect(repo).toMatchObject({ origin: "dispatched", commit: sha("a") });
		expect(repo?.serviceId?.equals(service._id)).toBe(true);
	});

	it("records a pushed destination nothing created in the conversation as discovered", async () => {
		const service = await insertService();
		stubHub({ repos: { "models/testuser/qwen-sft": PUSHED_DURING_RUN } });

		await check(service);

		expect(await artefactAt(service.conversationId, "hf://models/testuser/qwen-sft")).toMatchObject(
			{
				kind: "model",
				origin: "discovered",
				url: "https://huggingface.co/testuser/qwen-sft",
				commit: sha("a"),
				serviceId: service._id,
			}
		);
	});

	it("says missing when the last commit is from before the run", async () => {
		const service = await insertService();
		await insertArtefact(service.conversationId, { uri: "hf://models/testuser/qwen-sft" });
		stubHub({ repos: { "models/testuser/qwen-sft": RESERVED } });

		expect(await check(service)).toEqual([
			{ uri: "hf://models/testuser/qwen-sft", status: "missing" },
		]);
		const repo = await artefactAt(service.conversationId, "hf://models/testuser/qwen-sft");
		expect(repo).not.toHaveProperty("serviceId");
		expect(repo).not.toHaveProperty("commit");
	});

	it("does not count the commit that created the repo during the run", async () => {
		const service = await insertService();
		const created = iso(STARTED, 5_000);
		stubHub({
			repos: {
				"models/testuser/qwen-sft": {
					sha: sha("c"),
					lastModified: created,
					createdAt: created,
					commits: [{ id: sha("c"), date: created }],
				},
			},
		});

		expect(await check(service)).toEqual([
			{ uri: "hf://models/testuser/qwen-sft", status: "missing" },
		]);
	});

	it("says missing when the repo exists under neither kind", async () => {
		const service = await insertService({
			expectedPushes: [{ kind: "model", uri: "hf://models/testuser/qwen-sft", guessed: true }],
		});
		const fetchMock = stubHub();

		expect(await check(service)).toEqual([
			{ uri: "hf://models/testuser/qwen-sft", status: "missing" },
		]);
		expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(
			expect.arrayContaining(["/api/models/testuser/qwen-sft", "/api/datasets/testuser/qwen-sft"])
		);
	});

	it("finds the push under the other kind when push_to_hub's kind was a guess", async () => {
		const service = await insertService({
			expectedPushes: [{ kind: "model", uri: "hf://models/testuser/clean", guessed: true }],
		});
		stubHub({ repos: { "datasets/testuser/clean": PUSHED_DURING_RUN } });

		expect(await check(service)).toEqual([
			{ uri: "hf://datasets/testuser/clean", status: "pushed", commit: sha("a") },
		]);
		expect(await artefactAt(service.conversationId, "hf://datasets/testuser/clean")).toMatchObject({
			kind: "dataset",
			url: "https://huggingface.co/datasets/testuser/clean",
		});
	});

	it("keeps an explicit destination to its own kind", async () => {
		const service = await insertService();
		const fetchMock = stubHub({ repos: { "datasets/testuser/qwen-sft": PUSHED_DURING_RUN } });

		expect(await check(service)).toEqual([
			{ uri: "hf://models/testuser/qwen-sft", status: "missing" },
		]);
		const read = fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);
		expect(read).not.toContain("/api/datasets/testuser/qwen-sft");
	});

	it("reads a reserved repo once when the script's guessed kind resolves to it", async () => {
		const service = await insertService({
			expectedPushes: [{ kind: "model", uri: "hf://models/testuser/clean", guessed: true }],
		});
		await insertArtefact(service.conversationId, {
			uri: "hf://datasets/testuser/clean",
			kind: "dataset",
		});
		stubHub({
			repos: { "datasets/testuser/clean": PUSHED_DURING_RUN },
			listings: { "datasets?testuser": [{ id: "testuser/clean", ...PUSHED_DURING_RUN }] },
		});

		expect(await check(service)).toEqual([
			{ uri: "hf://datasets/testuser/clean", status: "pushed", commit: sha("a") },
		]);
	});

	it("reads the history when a later commit sits on top of the job's", async () => {
		const service = await insertService();
		stubHub({
			repos: {
				"models/testuser/qwen-sft": {
					sha: sha("d"),
					lastModified: iso(ENDED, 30 * MINUTE),
					createdAt: iso(SUBMITTED, -MINUTE),
					commits: [
						{ id: sha("d"), date: iso(ENDED, 30 * MINUTE) },
						{ id: sha("b"), date: iso(ENDED, -MINUTE) },
						{ id: sha("0"), date: iso(SUBMITTED, -MINUTE) },
					],
				},
			},
		});

		expect(await check(service)).toEqual([
			{ uri: "hf://models/testuser/qwen-sft", status: "pushed", commit: sha("b") },
		]);
	});

	it("does not credit the job with the conversation's own put during the run", async () => {
		const service = await insertService();
		await insertArtefact(service.conversationId, {
			uri: "hf://models/testuser/qwen-sft/README.md",
			kind: "file",
			commit: sha("e"),
		});
		const readmeAt = iso(STARTED, 10 * MINUTE);
		stubHub({
			repos: {
				"models/testuser/qwen-sft": {
					sha: sha("e"),
					lastModified: readmeAt,
					createdAt: iso(SUBMITTED, -MINUTE),
					commits: [
						{ id: sha("e"), date: readmeAt },
						{ id: sha("0"), date: iso(SUBMITTED, -MINUTE) },
					],
				},
			},
		});

		expect(await check(service)).toEqual([
			{ uri: "hf://models/testuser/qwen-sft", status: "missing" },
		]);
	});

	it("credits the job with none of the puts the conversation made to one path", async () => {
		const service = await insertService();
		await insertArtefact(service.conversationId, {
			uri: "hf://models/testuser/qwen-sft/README.md",
			kind: "file",
			commit: sha("f"),
			putCommits: [sha("e"), sha("f")],
		});
		const firstPut = iso(STARTED, 10 * MINUTE);
		const secondPut = iso(STARTED, 20 * MINUTE);
		stubHub({
			repos: {
				"models/testuser/qwen-sft": {
					sha: sha("f"),
					lastModified: secondPut,
					createdAt: iso(SUBMITTED, -MINUTE),
					commits: [
						{ id: sha("f"), date: secondPut },
						{ id: sha("e"), date: firstPut },
						{ id: sha("0"), date: iso(SUBMITTED, -MINUTE) },
					],
				},
			},
		});

		expect(await check(service)).toEqual([
			{ uri: "hf://models/testuser/qwen-sft", status: "missing" },
		]);
	});
});

describe("checkServicePushes: repos nobody named", () => {
	it("reports a known repo only when it changed during the run", async () => {
		const service = await insertService({ expectedPushes: undefined });
		await insertArtefact(service.conversationId, {
			uri: "hf://datasets/testuser/evals",
			kind: "dataset",
		});
		await insertArtefact(service.conversationId, { uri: "hf://models/testuser/untouched" });
		stubHub({
			repos: {
				"datasets/testuser/evals": PUSHED_DURING_RUN,
				"models/testuser/untouched": RESERVED,
			},
		});

		expect(await check(service)).toEqual([
			{ uri: "hf://datasets/testuser/evals", status: "pushed", commit: sha("a") },
		]);
		const untouched = await artefactAt(service.conversationId, "hf://models/testuser/untouched");
		expect(untouched).not.toHaveProperty("serviceId");
	});

	it("records repos the namespace listing shows changed during the run, linked to the job", async () => {
		const service = await insertService();
		const inRun = iso(ENDED, -5 * MINUTE);
		stubHub({
			repos: { "models/testuser/qwen-sft": PUSHED_DURING_RUN },
			listings: {
				"models?testuser": [
					{ id: "testuser/qwen-sft", ...PUSHED_DURING_RUN },
					{
						id: "testuser/qwen-sft-merged",
						sha: sha("f"),
						lastModified: inRun,
						createdAt: iso(ENDED, -10 * MINUTE),
					},
					{ id: "testuser/older", sha: sha("1"), lastModified: iso(SUBMITTED, -60 * MINUTE) },
					{ id: "testuser/empty", sha: sha("2"), lastModified: inRun, createdAt: inRun },
				],
				"datasets?testuser": [
					{ id: "testuser/sft-trackio-dataset", sha: sha("3"), lastModified: inRun },
					{ id: "testuser/generations", sha: sha("4"), lastModified: inRun },
				],
			},
		});

		expect(await check(service)).toEqual([
			{ uri: "hf://models/testuser/qwen-sft", status: "pushed", commit: sha("a") },
			{
				uri: "hf://models/testuser/qwen-sft-merged",
				status: "pushed",
				commit: sha("f"),
				discovered: true,
			},
			{
				uri: "hf://datasets/testuser/generations",
				status: "pushed",
				commit: sha("4"),
				discovered: true,
			},
		]);
		const merged = await artefactAt(service.conversationId, "hf://models/testuser/qwen-sft-merged");
		expect(merged).toMatchObject({
			origin: "discovered",
			commit: sha("f"),
			serviceId: service._id,
		});
		expect(
			await artefactAt(service.conversationId, "hf://datasets/testuser/sft-trackio-dataset")
		).toBeNull();
	});

	it("lists the namespaces the script pushes to as well as the job's own", async () => {
		const service = await insertService({
			namespace: "billing-org",
			expectedPushes: [{ kind: "model", uri: "hf://models/testuser/qwen-sft" }],
		});
		const fetchMock = stubHub({ repos: { "models/testuser/qwen-sft": PUSHED_DURING_RUN } });

		await check(service);

		const listed = fetchMock.mock.calls
			.map(([url]) => new URL(String(url)))
			.filter((url) => url.searchParams.has("author"))
			.map((url) => `${url.pathname} ${url.searchParams.get("author")}`);
		expect(listed.sort()).toEqual([
			"/api/datasets billing-org",
			"/api/datasets testuser",
			"/api/models billing-org",
			"/api/models testuser",
		]);
	});

	it("leaves a repo that a job running alongside named to that job", async () => {
		const service = await insertService();
		await insertService({
			conversationId: service.conversationId,
			jobId: "fedcbafedcbafedcbafedcba",
			expectedPushes: [{ kind: "model", uri: "hf://models/testuser/dpo" }],
			startedAt: new Date(STARTED.getTime() + 10 * MINUTE),
		});
		await insertArtefact(service.conversationId, { uri: "hf://models/testuser/dpo" });
		stubHub({
			repos: {
				"models/testuser/qwen-sft": PUSHED_DURING_RUN,
				"models/testuser/dpo": PUSHED_DURING_RUN,
			},
			listings: { "models?testuser": [{ id: "testuser/dpo", ...PUSHED_DURING_RUN }] },
		});

		expect(await check(service)).toEqual([
			{ uri: "hf://models/testuser/qwen-sft", status: "pushed", commit: sha("a") },
		]);
		expect(await artefactAt(service.conversationId, "hf://models/testuser/dpo")).not.toHaveProperty(
			"serviceId"
		);
	});
});

describe("checkServicePushes: when the Hub cannot say", () => {
	it("gives up at its timeout and reports nothing", async () => {
		const service = await insertService();
		stubHub({ hang: true });

		const started = Date.now();
		expect(await check(service, 50)).toBeUndefined();
		expect(Date.now() - started).toBeLessThan(2_000);
	});

	it("reports nothing when every read fails", async () => {
		const service = await insertService();
		stubHub({ status: 500 });

		expect(await check(service)).toBeUndefined();
		expect(await artefactAt(service.conversationId, "hf://models/testuser/qwen-sft")).toBeNull();
	});

	it("checks nothing for a job only seen in a call", async () => {
		const service = await insertService({ origin: "discovered" });
		const fetchMock = stubHub();

		expect(await check(service)).toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("checks nothing for a sandbox", async () => {
		const service = await insertService({ kind: "sandbox" });
		const fetchMock = stubHub();

		expect(await check(service)).toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
