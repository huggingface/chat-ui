import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import { createSchemaPreflightGuard } from "$lib/server/mcp/preflightGuard";
import {
	createJobLabelRewrite,
	SESSION_LABEL_KEY,
	type SessionJobLabels,
} from "$lib/server/mcp/jobLabels";
import { createMlBudgetGuard } from "$lib/server/mlBudget/guard";
import { readMlBudget } from "$lib/server/mlBudget/budget";
import { resetPriceCacheForTests } from "$lib/server/mlBudget/pricing";
import {
	composeGuards,
	type GuardedToolCall,
	type GuardOutcome,
} from "$lib/server/textGeneration/mcp/toolGuard";
import { MessageUpdateType } from "$lib/types/MessageUpdate";
import { createMlRecordingGuard } from "./recordingGuard";
import { listMlArtefacts, listMlServices } from "./store";
import { loadSessionJobLabels, RECONCILE_DELAY_MS } from "./sessionLabel";

beforeAll(async () => {
	await ready;
});

const conversationIds: ObjectId[] = [];

beforeEach(() => {
	resetPriceCacheForTests();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			throw new Error("offline");
		})
	);
});

afterEach(async () => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	await collections.mlServices.deleteMany({ conversationId: { $in: conversationIds } });
	await collections.mlArtefacts.deleteMany({ conversationId: { $in: conversationIds } });
	await collections.mlSessionLabels.deleteMany({ _id: { $in: conversationIds } });
	await collections.conversations.deleteMany({ _id: { $in: conversationIds } });
	conversationIds.length = 0;
});

const newConversationId = () => {
	const id = new ObjectId();
	conversationIds.push(id);
	return id;
};

const HF_URL = "https://hf.co/mcp?login";
const JOB_ID = "0123456789abcdef01234567";
const SANDBOX_JOB_ID = "abcdefabcdefabcdefabcdef";
const OTHER_JOB_ID = "fedcbafedcbafedcbafedcba";

const JOB_REPLY = {
	operation: "uv",
	outcome: {
		kind: "job",
		job: {
			id: JOB_ID,
			url: `https://huggingface.co/jobs/testuser/${JOB_ID}`,
			created_at: "2026-09-19T13:11:53.053Z",
			docker_image: "ghcr.io/astral-sh/uv:python3.12-bookworm",
			command: ["uv", "run", "..."],
			flavor: "a10g-small",
			status: { stage: "SCHEDULING", message: null },
			owner: { id: "u1", name: "testuser", type: "user" },
			labels: {},
			timeout_seconds: 1800,
		},
		logs: ["..."],
		logs_finished: false,
		logs_truncated: false,
	},
	total_results: 1,
	results_shared: 1,
};

const HELP_REPLY = {
	operation: "uv",
	outcome: { kind: "help", operation: "uv", reason: "requested", instructions: "# Command help" },
	total_results: 0,
	results_shared: 0,
};

const SANDBOX_REPLY = {
	op: "create",
	handle: `hfsb2:testuser:${SANDBOX_JOB_ID}`,
	name: "smoke",
	namespace: "testuser",
	job_id: SANDBOX_JOB_ID,
	url: `https://${SANDBOX_JOB_ID}--49983.hf.jobs`,
	job_url: `https://huggingface.co/jobs/testuser/${SANDBOX_JOB_ID}`,
	volumes: [],
};

const REPO_REPLY = {
	action: "created",
	id: "68d000000000000000000001",
	repo: "testuser/demo",
	repo_type: "dataset",
	uri: "hf://datasets/testuser/demo",
	url: "https://huggingface.co/datasets/testuser/demo",
};

const putReply = (path: string, oid: string) => ({
	op: "put",
	uri: `hf://datasets/testuser/demo/${path}`,
	repo: "testuser/demo",
	repo_type: "dataset",
	path,
	bytes: 373,
	message: `Add ${path}`,
	commit: { oid, url: `https://huggingface.co/datasets/testuser/demo/commit/${oid}` },
});

const SHA_1 = "a".repeat(40);
const SHA_2 = "b".repeat(40);

const ok = (structured?: unknown, text = "ok"): GuardOutcome => ({
	status: "success",
	text,
	...(structured !== undefined ? { structured } : {}),
});

function makeGuard(conversationId: ObjectId, jobLabels?: SessionJobLabels) {
	let n = 0;
	const guard = createMlRecordingGuard({
		conversationId,
		generationId: "gen-1",
		messageId: "msg-1",
		namespace: "testuser",
		...(jobLabels ? { jobLabels } : {}),
	});
	/** after only with a ticket, as executeToolCalls does */
	const dispatch = async (
		tool: string,
		args: Record<string, unknown>,
		outcome: GuardOutcome,
		{
			serverUrl = HF_URL,
			fileRefs,
		}: { serverUrl?: string; fileRefs?: GuardedToolCall["fileRefs"] } = {}
	) => {
		const verdict = await guard.before({
			serverUrl,
			tool,
			fnName: tool,
			args,
			...(fileRefs ? { fileRefs } : {}),
			callUuid: `uuid-${++n}`,
		});
		if (!verdict.allow) throw new Error("the recording guard refused a call");
		if (verdict.ticket !== undefined) await guard.after(verdict.ticket, outcome);
		return verdict;
	};
	return { guard, dispatch };
}

describe.sequential("mlRegistry recording guard: services", () => {
	it("records a submitted job from the reply, with the name only the arguments carry", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);

		const verdict = await dispatch(
			"hf_jobs",
			{
				operation: "uv",
				args: { script: "print(1)", flavor: "a10g-small", timeout: "30m", name: "sft-smoke" },
			},
			ok(JOB_REPLY)
		);

		expect(verdict).toEqual({ allow: true, ticket: expect.anything() });
		const services = await listMlServices(conversationId);
		expect(services).toHaveLength(1);
		expect(services[0]).toMatchObject({
			conversationId,
			kind: "job",
			jobId: JOB_ID,
			namespace: "testuser",
			name: "sft-smoke",
			flavor: "a10g-small",
			timeoutSeconds: 1800,
			stage: "SCHEDULING",
			origin: "dispatched",
			reservationKey: "gen-1:uuid-1",
			hubUrl: `https://huggingface.co/jobs/testuser/${JOB_ID}`,
			messageId: "msg-1",
			generationId: "gen-1",
			toolUuid: "uuid-1",
		});
		expect(services[0]).not.toHaveProperty("stageMessage");
		expect(services[0]).not.toHaveProperty("handle");
		expect(services[0]).not.toHaveProperty("scriptRefs");
	});

	it("records which virtual file version a job's script was expanded from", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);
		const resolved = { ref: "v-file://train.py", name: "train.py", version: 4 };

		await dispatch(
			"hf_jobs",
			{ operation: "uv", args: { script: "print(4)", flavor: "a10g-small", timeout: "30m" } },
			ok(JOB_REPLY),
			{ fileRefs: [resolved] }
		);

		const [service] = await listMlServices(conversationId);
		expect(service.jobId).toBe(JOB_ID);
		expect(service.scriptRefs).toEqual([{ name: "train.py", version: 4 }]);
	});

	it("records where the expanded script says the job will push", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);

		await dispatch(
			"hf_jobs",
			{
				operation: "uv",
				args: {
					script: [
						'HUB_ID = "testuser/qwen-sft"',
						"cfg = SFTConfig(push_to_hub=True, hub_model_id=HUB_ID)",
						'trackio.init(project="sft", space_id="testuser/sft-trackio")',
						'evals.push_to_hub(f"{user}/evals")',
					].join("\n"),
					script_args: ["--epochs", "3"],
					flavor: "a10g-small",
					timeout: "2h",
				},
			},
			ok(JOB_REPLY),
			{ fileRefs: [{ name: "train.py", version: 2 }] }
		);

		const [service] = await listMlServices(conversationId);
		expect(service.expectedPushes).toEqual([
			{ kind: "model", uri: "hf://models/testuser/qwen-sft" },
		]);
	});

	it("records no destinations for a script that names none", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);

		await dispatch(
			"hf_jobs",
			{ operation: "uv", args: { script: "print(1)", flavor: "a10g-small", timeout: "30m" } },
			ok(JOB_REPLY)
		);

		const [service] = await listMlServices(conversationId);
		expect(service).not.toHaveProperty("expectedPushes");
	});

	it("falls back to the arguments when the reply is text only", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);

		await dispatch(
			"hf_jobs",
			{ operation: "run", args: { image: "python:3.12", flavor: "t4-small", timeout: "10m" } },
			ok(undefined, `Job started: https://huggingface.co/jobs/testuser/${JOB_ID}`)
		);

		const [service] = await listMlServices(conversationId);
		expect(service).toMatchObject({
			kind: "job",
			jobId: JOB_ID,
			namespace: "testuser",
			flavor: "t4-small",
			timeoutSeconds: 600,
			stage: "UNKNOWN",
			origin: "dispatched",
		});
		expect(service).not.toHaveProperty("name");
	});

	it("records a created sandbox with its handle and the --name token", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);

		await dispatch(
			"hf_sandbox",
			{
				cmd: "create",
				args: ["create", "--name", "smoke", "--flavor", "cpu-basic", "--timeout", "1h"],
			},
			ok(SANDBOX_REPLY)
		);

		const services = await listMlServices(conversationId);
		expect(services).toHaveLength(1);
		expect(services[0]).toMatchObject({
			kind: "sandbox",
			jobId: SANDBOX_JOB_ID,
			namespace: "testuser",
			handle: `hfsb2:testuser:${SANDBOX_JOB_ID}`,
			name: "smoke",
			flavor: "cpu-basic",
			timeoutSeconds: 3600,
			stage: "UNKNOWN",
			origin: "dispatched",
			reservationKey: "gen-1:uuid-1",
			hubUrl: `https://huggingface.co/jobs/testuser/${SANDBOX_JOB_ID}`,
		});
	});

	it("records nothing for a help reply", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);

		await dispatch("hf_jobs", { operation: "uv", args: { help: true } }, ok(HELP_REPLY));

		expect(await listMlServices(conversationId)).toHaveLength(0);
	});

	it("records nothing when the submission failed", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);

		await dispatch(
			"hf_jobs",
			{ operation: "uv", args: { script: "x", flavor: "a10g-small", timeout: "1h" } },
			{ status: "error", text: "quota exceeded" }
		);
		await dispatch(
			"hf_sandbox",
			{ cmd: "create", args: ["create", "--flavor", "cpu-basic", "--timeout", "1h"] },
			{ status: "transport_error" }
		);

		expect(await listMlServices(conversationId)).toHaveLength(0);
	});

	it("ignores the same calls on a server that is not the Hub", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);

		const verdict = await dispatch(
			"hf_jobs",
			{ operation: "uv", args: { script: "x" } },
			ok(JOB_REPLY),
			{ serverUrl: "https://other.example/mcp" }
		);

		expect(verdict).toEqual({ allow: true });
		expect(await listMlServices(conversationId)).toHaveLength(0);
	});
});

describe.sequential("mlRegistry recording guard: artefacts", () => {
	it("keeps one repo row and one file row across a create and two writes, the commit following the last", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);

		await dispatch(
			"create_repo",
			{ uri: "hf://datasets/testuser/demo", private: true },
			ok(REPO_REPLY)
		);
		await dispatch(
			"hf_fs_write",
			{
				cmd: "put",
				args: ["put", "hf://datasets/testuser/demo/README.md", "-m", "Add card"],
				content: "# demo",
			},
			ok(putReply("README.md", SHA_1))
		);
		await dispatch(
			"hf_fs_write",
			{
				cmd: "put",
				args: ["put", "hf://datasets/testuser/demo/README.md", "-m", "Fix card"],
				content: "# demo!",
			},
			ok(putReply("README.md", SHA_2))
		);

		const artefacts = await listMlArtefacts(conversationId);
		expect(artefacts).toHaveLength(2);
		const [repo, file] = artefacts;
		expect(repo).toMatchObject({
			kind: "dataset",
			uri: "hf://datasets/testuser/demo",
			url: "https://huggingface.co/datasets/testuser/demo",
			origin: "dispatched",
			toolUuid: "uuid-1",
			messageId: "msg-1",
			generationId: "gen-1",
		});
		expect(file).toMatchObject({
			kind: "file",
			uri: "hf://datasets/testuser/demo/README.md",
			url: "https://huggingface.co/datasets/testuser/demo/blob/main/README.md",
			origin: "dispatched",
			commit: SHA_2,
			toolUuid: "uuid-2",
		});
		expect(file.updatedAt.getTime()).toBeGreaterThanOrEqual(file.createdAt.getTime());
	});

	it("clears the commit when a later write reports none", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);
		const put = {
			cmd: "put",
			args: ["put", "hf://datasets/testuser/demo/README.md"],
			content: "x",
		};

		await dispatch("hf_fs_write", put, ok(putReply("README.md", SHA_1)));
		await dispatch("hf_fs_write", put, ok(undefined, "# hf_fs_write put\n\nPath: `README.md`"));

		const file = (await listMlArtefacts(conversationId)).find((a) => a.kind === "file");
		expect(file).toMatchObject({ uri: "hf://datasets/testuser/demo/README.md" });
		expect(file).not.toHaveProperty("commit");
	});

	it("records the virtual file version a put uploaded, and forgets it when a later put is inline", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);
		const put = (content: string) => ({
			cmd: "put",
			args: ["put", "hf://datasets/testuser/demo/train.py"],
			content,
		});
		const fileRow = async () =>
			(await listMlArtefacts(conversationId)).find((a) => a.kind === "file");

		await dispatch("hf_fs_write", put("print(2)"), ok(putReply("train.py", SHA_1)), {
			fileRefs: [{ name: "train.py", version: 2 }],
		});
		expect(await fileRow()).toMatchObject({
			commit: SHA_1,
			fromFile: { name: "train.py", version: 2 },
		});

		await dispatch("hf_fs_write", put("print(3)"), ok(putReply("train.py", SHA_2)));
		const file = await fileRow();
		expect(file?.commit).toBe(SHA_2);
		expect(file).not.toHaveProperty("fromFile");
	});

	it("gives a file written into a repo the session never created a discovered parent", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);

		await dispatch(
			"hf_fs_write",
			{ cmd: "put", args: ["put", "hf://models/testuser/tiny/train.py"], content: "print(1)" },
			ok(undefined, "# hf_fs_write put\n\nPath: `train.py`")
		);

		const artefacts = await listMlArtefacts(conversationId);
		expect(artefacts).toHaveLength(2);
		expect(artefacts[0]).toMatchObject({
			kind: "model",
			uri: "hf://models/testuser/tiny",
			url: "https://huggingface.co/testuser/tiny",
			origin: "discovered",
		});
		expect(artefacts[1]).toMatchObject({
			kind: "file",
			uri: "hf://models/testuser/tiny/train.py",
			url: "https://huggingface.co/testuser/tiny/blob/main/train.py",
			origin: "dispatched",
		});
		expect(artefacts[1]).not.toHaveProperty("commit");
	});

	it("records nothing for a removal or a failed write", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);

		await dispatch(
			"hf_fs_write",
			{ cmd: "rm", args: ["rm", "hf://datasets/testuser/demo/old.csv"] },
			ok({ op: "rm", uri: "hf://datasets/testuser/demo/old.csv" })
		);
		await dispatch(
			"hf_fs_write",
			{ cmd: "put", args: ["put", "hf://datasets/testuser/demo/x.csv"], content: "1" },
			{ status: "error", text: "Repository not found" }
		);

		expect(await listMlArtefacts(conversationId)).toHaveLength(0);
	});
});

describe.sequential("mlRegistry recording guard: the discovered rule", () => {
	it("records a job id first seen in a read, once", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);

		const read = { operation: "logs", args: { job_id: OTHER_JOB_ID, namespace: "someone-else" } };
		await dispatch("hf_jobs", read, ok(undefined, "log line"));
		await dispatch("hf_jobs", read, ok(undefined, "log line"));
		await dispatch("hf_jobs", { operation: "cancel", args: { job_id: OTHER_JOB_ID } }, ok());

		const services = await listMlServices(conversationId);
		expect(services).toHaveLength(1);
		expect(services[0]).toMatchObject({
			kind: "job",
			jobId: OTHER_JOB_ID,
			namespace: "someone-else",
			stage: "UNKNOWN",
			origin: "discovered",
			hubUrl: `https://huggingface.co/jobs/someone-else/${OTHER_JOB_ID}`,
		});
		expect(services[0]).not.toHaveProperty("reservationKey");
	});

	it("leaves a job it dispatched untouched when the model reads it back", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);

		await dispatch("hf_jobs", { operation: "uv", args: { script: "x" } }, ok(JOB_REPLY));
		await dispatch(
			"hf_jobs",
			{ operation: "logs", args: { job_id: JOB_ID } },
			ok(undefined, "...")
		);

		const services = await listMlServices(conversationId);
		expect(services).toHaveLength(1);
		expect(services[0]).toMatchObject({ origin: "dispatched", stage: "SCHEDULING" });
	});

	it("does not twin a sandbox as a job when its id is read through hf_jobs", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);

		await dispatch(
			"hf_sandbox",
			{ cmd: "create", args: ["create", "--flavor", "cpu-basic", "--timeout", "1h"] },
			ok(SANDBOX_REPLY)
		);
		await dispatch("hf_jobs", { operation: "logs", args: { job_id: SANDBOX_JOB_ID } }, ok());

		const services = await listMlServices(conversationId);
		expect(services).toHaveLength(1);
		expect(services[0].kind).toBe("sandbox");
	});

	it("discovers a sandbox from any handle form the tools accept", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);
		const idA = "aaaaaaaaaaaaaaaaaaaaaaaa";
		const idB = "bbbbbbbbbbbbbbbbbbbbbbbb";
		const idC = "cccccccccccccccccccccccc";

		await dispatch(
			"hf_sandbox_exec",
			{ cmd: "exec", args: ["exec", `hfsb2:org-a:${idA}`, "ls"] },
			ok()
		);
		await dispatch(
			"hf_sandbox_fs",
			{ cmd: "cat", args: ["cat", `org-b/${idB}`, "/data/x.py"] },
			ok()
		);
		await dispatch("hf_sandbox", { cmd: "status", args: ["status", idC] }, ok());

		const services = await listMlServices(conversationId);
		expect(services.map((s) => [s.kind, s.jobId, s.namespace, s.handle, s.origin])).toEqual([
			["sandbox", idA, "org-a", `hfsb2:org-a:${idA}`, "discovered"],
			["sandbox", idB, "org-b", `hfsb2:org-b:${idB}`, "discovered"],
			["sandbox", idC, "testuser", `hfsb2:testuser:${idC}`, "discovered"],
		]);
	});

	it("does not take a path that ends in 24 hex digits for a handle", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);

		await dispatch(
			"hf_sandbox_fs",
			{ cmd: "cat", args: ["cat", `org-b/${SANDBOX_JOB_ID}`, `/tmp/${JOB_ID}.log`] },
			ok()
		);

		expect((await listMlServices(conversationId)).map((s) => s.jobId)).toEqual([SANDBOX_JOB_ID]);
	});
});

describe.sequential("mlRegistry recording guard: never breaks the round", () => {
	it("swallows a write failure in after()", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);
		const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
		vi.spyOn(collections.mlServices, "updateOne").mockRejectedValueOnce(new Error("db down"));

		await expect(
			dispatch("hf_jobs", { operation: "uv", args: { script: "x" } }, ok(JOB_REPLY))
		).resolves.toBeDefined();

		expect(error).toHaveBeenCalledWith(
			expect.objectContaining({ err: "Error: db down", kind: "job" }),
			expect.stringContaining("after() failed")
		);
	});

	it("swallows a write failure in before() and still allows the call", async () => {
		const conversationId = newConversationId();
		const { guard } = makeGuard(conversationId);
		const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
		vi.spyOn(collections.mlServices, "updateOne").mockRejectedValueOnce(new Error("db down"));

		const verdict = await guard.before({
			serverUrl: HF_URL,
			tool: "hf_jobs",
			fnName: "hf_jobs",
			args: { operation: "logs", args: { job_id: OTHER_JOB_ID } },
			callUuid: "uuid-x",
		});

		expect(verdict).toEqual({ allow: true });
		expect(error).toHaveBeenCalledWith(
			expect.objectContaining({ err: "Error: db down" }),
			expect.stringContaining("discovered")
		);
	});
});

describe.sequential("mlRegistry recording guard: in the chain", () => {
	it("leaves the budget's update on the verdict and still hears the outcome", async () => {
		const conversationId = newConversationId();
		await collections.conversations.insertOne({
			_id: conversationId,
			title: "chain test",
			model: "test-model",
			messages: [],
			createdAt: new Date(),
			updatedAt: new Date(),
			sessionId: `chain-test-${conversationId.toString()}`,
			mlAssistant: true,
			mlBudget: { totalMicroUsd: 10_000_000, spentMicroUsd: 0, reservations: [] },
		});
		const recording = createMlRecordingGuard({
			conversationId,
			generationId: "gen-1",
			messageId: "msg-1",
			namespace: "testuser",
		});
		const budget = createMlBudgetGuard({
			conversationId,
			generationId: "gen-1",
			username: "testuser",
		});
		const guard = [createSchemaPreflightGuard({}), recording, budget].reduce(composeGuards);

		const verdict = await guard.before({
			serverUrl: HF_URL,
			tool: "hf_jobs",
			fnName: "hf_jobs",
			args: { operation: "uv", args: { script: "x", flavor: "a10g-small", timeout: "30m" } },
			fileRefs: [{ name: "train.py", version: 1 }],
			callUuid: "uuid-1",
		});
		if (!verdict.allow) throw new Error(verdict.message);
		expect(verdict.update).toMatchObject({ type: MessageUpdateType.Budget });
		expect(guard.allowParking).toBe(false);

		const update = await guard.after(verdict.ticket, ok(JOB_REPLY));

		expect(update).toMatchObject({ type: MessageUpdateType.Budget });
		const [service] = await listMlServices(conversationId);
		expect(service).toMatchObject({
			jobId: JOB_ID,
			reservationKey: "gen-1:uuid-1",
			scriptRefs: [{ name: "train.py", version: 1 }],
		});
		expect((await readMlBudget(conversationId))?.reservations).toEqual([
			expect.objectContaining({ key: "gen-1:uuid-1", jobId: JOB_ID }),
		]);
	});

	it("hears nothing about a call the budget refused", async () => {
		const conversationId = newConversationId();
		await collections.conversations.insertOne({
			_id: conversationId,
			title: "chain test",
			model: "test-model",
			messages: [],
			createdAt: new Date(),
			updatedAt: new Date(),
			sessionId: `chain-test-${conversationId.toString()}`,
			mlAssistant: true,
			mlBudget: { totalMicroUsd: 1, spentMicroUsd: 0, reservations: [] },
		});
		const recording = createMlRecordingGuard({
			conversationId,
			generationId: "gen-1",
			namespace: "testuser",
		});
		const budget = createMlBudgetGuard({
			conversationId,
			generationId: "gen-1",
			username: "testuser",
		});
		const guard = [createSchemaPreflightGuard({}), recording, budget].reduce(composeGuards);

		const verdict = await guard.before({
			serverUrl: HF_URL,
			tool: "hf_jobs",
			fnName: "hf_jobs",
			args: { operation: "uv", args: { script: "x", flavor: "a10g-small", timeout: "30m" } },
			callUuid: "uuid-1",
		});

		expect(verdict.allow).toBe(false);
		expect(await listMlServices(conversationId)).toHaveLength(0);
	});
});

describe.sequential("mlRegistry recording guard: session labels", () => {
	const labelled = (jobLabels: SessionJobLabels, args: Record<string, unknown>) =>
		createJobLabelRewrite(jobLabels)({ serverUrl: HF_URL, tool: "hf_jobs", args });

	it("records the name the rewrite sent and adds the job to the session's own", async () => {
		const conversationId = newConversationId();
		const jobLabels = await loadSessionJobLabels(conversationId);
		const { dispatch } = makeGuard(conversationId, jobLabels);

		await dispatch(
			"hf_jobs",
			labelled(jobLabels, {
				operation: "uv",
				args: { script: "print(1)", flavor: "a10g-small", timeout: "30m", name: "sft-smoke" },
			}),
			ok(JOB_REPLY)
		);

		const [service] = await listMlServices(conversationId);
		expect(service.name).toBe("ml-intern-sft-smoke");
		expect(jobLabels.ownJobs.get(JOB_ID)).toBe("ml-intern-sft-smoke");
	});

	it("marks the reconcile due before dispatch, so a lost reply still gets one", async () => {
		const conversationId = newConversationId();
		const jobLabels = await loadSessionJobLabels(conversationId);
		const { dispatch } = makeGuard(conversationId, jobLabels);
		const before = Date.now();

		await dispatch(
			"hf_jobs",
			labelled(jobLabels, {
				operation: "run",
				args: { command: ["python", "train.py"], flavor: "t4-small", timeout: "1h" },
			}),
			{ status: "transport_error" }
		);

		expect(await listMlServices(conversationId)).toHaveLength(0);
		const row = await collections.mlSessionLabels.findOne({ _id: conversationId });
		expect(row).toMatchObject({
			value: jobLabels.session,
			namespaces: ["testuser"],
			submissions: 1,
		});
		expect(row?.reconcileAt?.getTime()).toBeGreaterThanOrEqual(before + RECONCILE_DELAY_MS);
		expect(row?.reconcileUntil?.getTime()).toBeGreaterThan(before + 60 * 60 * 1000);
	});

	it("marks nothing for a turn that stamps no labels", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);
		await dispatch(
			"hf_jobs",
			{ operation: "uv", args: { script: "print(1)", flavor: "a10g-small", timeout: "30m" } },
			ok(JOB_REPLY)
		);
		expect(await collections.mlSessionLabels.findOne({ _id: conversationId })).toBeNull();
	});

	it("follows a relabel into the row and the session's own jobs", async () => {
		const conversationId = newConversationId();
		const jobLabels = await loadSessionJobLabels(conversationId);
		const { dispatch } = makeGuard(conversationId, jobLabels);
		await dispatch(
			"hf_jobs",
			labelled(jobLabels, {
				operation: "uv",
				args: { script: "x", flavor: "a10g-small", timeout: "30m", name: "first" },
			}),
			ok(JOB_REPLY)
		);

		const relabel = labelled(jobLabels, {
			operation: "update-labels",
			args: { job_id: JOB_ID, labels: { name: "second", stage: "eval" } },
		});
		expect((relabel.args as { labels: Record<string, string> }).labels).toEqual({
			name: "ml-intern-second",
			stage: "eval",
			[SESSION_LABEL_KEY]: jobLabels.session,
		});
		await dispatch("hf_jobs", relabel, { status: "error", text: "no" });
		expect((await listMlServices(conversationId))[0].name).toBe("ml-intern-first");

		await dispatch("hf_jobs", relabel, ok());
		expect((await listMlServices(conversationId))[0].name).toBe("ml-intern-second");
		expect(jobLabels.ownJobs.get(JOB_ID)).toBe("ml-intern-second");
	});

	it("refuses to relabel a sandbox it recorded, and still lets a job through", async () => {
		const conversationId = newConversationId();
		const { guard, dispatch } = makeGuard(conversationId);
		await dispatch(
			"hf_sandbox",
			{
				cmd: "create",
				args: ["create", "--name", "smoke", "--flavor", "cpu-basic", "--timeout", "1h"],
			},
			ok(SANDBOX_REPLY)
		);
		const relabel = (jobId: string) =>
			guard.before({
				serverUrl: HF_URL,
				tool: "hf_jobs",
				fnName: "hf_jobs",
				args: { operation: "update-labels", args: { job_id: jobId, labels: {} } },
				callUuid: `relabel-${jobId}`,
			});

		const sandbox = await relabel(SANDBOX_JOB_ID);
		expect(sandbox.allow).toBe(false);
		if (!sandbox.allow) expect(sandbox.message).toContain("is a sandbox");
		expect((await relabel(OTHER_JOB_ID)).allow).toBe(true);
	});

	it("records a relabel that dropped the name on a job it does not own", async () => {
		const conversationId = newConversationId();
		const { dispatch } = makeGuard(conversationId);
		await dispatch("hf_jobs", { operation: "logs", args: { job_id: OTHER_JOB_ID } }, ok());
		await collections.mlServices.updateOne(
			{ conversationId, jobId: OTHER_JOB_ID },
			{ $set: { name: "theirs" } }
		);
		await dispatch(
			"hf_jobs",
			{ operation: "update-labels", args: { job_id: OTHER_JOB_ID, labels: {} } },
			ok()
		);
		expect((await listMlServices(conversationId))[0]).not.toHaveProperty("name");
	});
});
