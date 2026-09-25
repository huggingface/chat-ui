import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { collections, ready } from "$lib/server/database";
import { writeMlFileVersion } from "$lib/server/mlFiles/store";
import type { MlArtefact } from "$lib/types/MlArtefact";
import type { MlFileListing } from "$lib/types/MlFile";
import type { MlService } from "$lib/types/MlService";

const mocks = vi.hoisted(() => ({ virtualFiles: vi.fn(() => true) }));

vi.mock("$lib/utils/mlAssistantFlag", () => ({ ML_ASSISTANT_MODE: true }));
vi.mock("$lib/server/mlFiles/enabled", () => ({ mlVirtualFilesEnabled: mocks.virtualFiles }));

const {
	buildSessionStateBlock,
	injectSessionState,
	markSessionStateRead,
	mlStateBlockEnabled,
	renderSessionStateBlock,
	SESSION_STATE_MAX_CHARS,
} = await import("./stateBlock");
const { claimServiceEvents } = await import("./events");

const NOW = new Date(Date.UTC(2026, 8, 25, 14, 5, 0));
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;

const JOB_ID = "0123456789abcdef01234567";
const SANDBOX_ID = "abcdefabcdefabcdefabcdef";
const conversationId = new ObjectId();

let nextId = 0;
const hexId = () => (nextId++).toString(16).padStart(24, "0");

const service = (overrides: Partial<MlService> = {}): MlService => ({
	_id: new ObjectId(),
	conversationId,
	kind: "job",
	jobId: JOB_ID,
	namespace: "ns",
	stage: "RUNNING",
	origin: "dispatched",
	hubUrl: `https://huggingface.co/jobs/ns/${JOB_ID}`,
	createdAt: ago(20 * MIN),
	updatedAt: ago(MIN),
	...overrides,
});

const artefact = (overrides: Partial<MlArtefact> = {}): MlArtefact => ({
	_id: new ObjectId(),
	conversationId,
	kind: "model",
	uri: "hf://models/ns/qwen-sft",
	url: "https://huggingface.co/ns/qwen-sft",
	origin: "dispatched",
	createdAt: ago(30 * MIN),
	updatedAt: ago(30 * MIN),
	...overrides,
});

const file = (overrides: Partial<MlFileListing> = {}): MlFileListing => ({
	name: "train.py",
	version: 5,
	size: 3277,
	updatedAt: ago(5 * MIN),
	...overrides,
});

const renderBlock = (state: Partial<Parameters<typeof renderSessionStateBlock>[0]>) =>
	renderSessionStateBlock({ services: [], artefacts: [], files: [], now: NOW, ...state });
const render = (state: Partial<Parameters<typeof renderSessionStateBlock>[0]>) =>
	renderBlock(state)?.text;

const linesOf = (block: string | undefined) => block?.split("\n") ?? [];

describe("renderSessionStateBlock", () => {
	it("renders nothing for a conversation with no services, artefacts or files", () => {
		expect(render({})).toBeUndefined();
	});

	it("renders every section with full ids and handles", () => {
		const block = render({
			services: [
				service({ name: "sft-qwen-smoke", flavor: "a10g-small", startedAt: ago(12 * MIN) }),
				service({
					kind: "sandbox",
					jobId: SANDBOX_ID,
					handle: `hfsb2:ns:${SANDBOX_ID}`,
					name: "dbg",
					flavor: "cpu-upgrade",
					createdAt: ago(41 * MIN),
					startedAt: ago(40 * MIN),
				}),
				service({
					jobId: "fedcba9876543210fedcba98",
					name: "sft-qwen-v1",
					flavor: "a10g-small",
					stage: "ERROR",
					startedAt: ago(10 * MIN),
					endedAt: ago(10 * MIN - 137_000),
				}),
			],
			artefacts: [
				artefact(),
				artefact({ kind: "file", uri: "hf://models/ns/qwen-sft/config.json" }),
				artefact({ kind: "file", uri: "hf://models/ns/qwen-sft/model.safetensors" }),
				artefact({ kind: "dataset", uri: "hf://datasets/ns/eval-set", createdAt: ago(20 * MIN) }),
				artefact({ kind: "dashboard", uri: "hf://spaces/ns/trackio-qwen" }),
			],
			files: [file(), file({ name: "configs/sft.yaml", version: 2, size: 410 })],
		});

		expect(block).toBe(
			[
				"[SESSION STATE — kept by the harness from the calls it dispatched and the Hub's job status, not written by the user. As of 14:05 UTC.]",
				"Running and queued:",
				`- job sft-qwen-smoke · a10g-small · RUNNING 12m 00s · id ${JOB_ID}`,
				`- sandbox dbg · cpu-upgrade · RUNNING 40m 00s · hfsb2:ns:${SANDBOX_ID}`,
				"Newly ended (listed once):",
				"- job sft-qwen-v1 · ERROR after 2m 17s · id fedcba9876543210fedcba98",
				"Created on the Hub:",
				"- model ns/qwen-sft (2 files)",
				"- dataset ns/eval-set",
				"- dashboard ns/trackio-qwen",
				"Virtual files:",
				"- v-file://train.py v5 · 3.2 KB",
				"- v-file://configs/sft.yaml v2 · 410 B",
			].join("\n")
		);
	});

	it("lists open services newest first", () => {
		const block = render({
			services: [
				service({ name: "older", createdAt: ago(30 * MIN) }),
				service({ name: "newer", createdAt: ago(2 * MIN) }),
			],
		});
		const rows = linesOf(block).filter((line) => line.startsWith("- job"));
		expect(rows.map((row) => row.split(" · ")[0])).toEqual(["- job newer", "- job older"]);
	});

	it("says how long a job has been queued", () => {
		const block = render({
			services: [service({ stage: "SCHEDULING", flavor: "a100-large", createdAt: ago(190_000) })],
		});
		expect(block).toContain(`- job 01234567 · a100-large · queued for 3m 10s · id ${JOB_ID}`);
	});

	it("builds a sandbox handle when the row has none", () => {
		const block = render({ services: [service({ kind: "sandbox", jobId: SANDBOX_ID })] });
		expect(block).toContain(`hfsb2:ns:${SANDBOX_ID}`);
	});

	it("names an unchecked service as such", () => {
		const block = render({ services: [service({ kind: "sandbox", stage: "UNKNOWN" })] });
		expect(block).toContain("· status not checked yet ·");
	});

	it("says the status is unknown once the user's session has expired", () => {
		const block = render({ services: [service({ tokenMissingSince: ago(MIN) })] });
		expect(block).toContain("· status unknown: the user's session expired, last seen RUNNING ·");
		expect(block).not.toMatch(/RUNNING \d/);
	});

	it("marks a discovered service and gives it no elapsed time", () => {
		const block = render({ services: [service({ origin: "discovered", startedAt: ago(MIN) })] });
		expect(block).toContain(
			`- job 01234567 (seen in a call, not launched here) · RUNNING · id ${JOB_ID}`
		);
	});

	it("lists a service the poller gave up on with the ended ones", () => {
		const block = render({
			services: [
				service({
					pollStoppedReason: "past its timeout and the last lookup failed",
					tokenMissingSince: ago(MIN),
				}),
			],
		});
		expect(linesOf(block).slice(1)).toEqual([
			"Newly ended (listed once):",
			`- job 01234567 · no longer tracked, last seen RUNNING · id ${JOB_ID}`,
		]);
	});

	it("times an ended row without an end from its last write", () => {
		const block = render({
			services: [
				service({ stage: "COMPLETED", startedAt: ago(10 * MIN), updatedAt: ago(5 * MIN) }),
			],
		});
		expect(block).toContain("· COMPLETED after 5m 00s ·");
	});

	it("lists an ended service until it has been reported, and an open one every time", () => {
		const running = service({ name: "running", lastReportedStage: "RUNNING" });
		const reported = service({ name: "reported", stage: "ERROR", lastReportedStage: "ERROR" });
		const endedSinceTold = service({
			name: "ended-since",
			stage: "COMPLETED",
			lastReportedStage: "RUNNING",
		});
		const untrackedAndTold = service({
			name: "untracked-told",
			pollStoppedReason: "50 consecutive failed lookups",
			lastReportedStage: "UNTRACKED",
		});

		const block = renderBlock({
			services: [running, reported, endedSinceTold, untrackedAndTold],
		});

		const rows = linesOf(block?.text).filter((line) => line.startsWith("- job"));
		expect(rows.map((row) => row.split(" · ")[0])).toEqual(["- job running", "- job ended-since"]);
		expect(block?.ended).toEqual([
			{ _id: endedSinceTold._id, stage: "COMPLETED", reported: "COMPLETED" },
		]);
	});

	it("still lists a row the poller gave up on after its running stage was reported", () => {
		const untracked = service({
			pollStoppedReason: "past its timeout and the last lookup failed",
			lastReportedStage: "RUNNING",
		});

		const block = renderBlock({ services: [untracked] });

		expect(block?.text).toContain("· no longer tracked, last seen RUNNING ·");
		expect(block?.ended).toEqual([{ _id: untracked._id, stage: "RUNNING", reported: "UNTRACKED" }]);
	});

	it("renders nothing once every ended service has been reported and nothing else is left", () => {
		const block = renderBlock({
			services: [service({ stage: "COMPLETED", lastReportedStage: "COMPLETED" })],
		});
		expect(block).toBeUndefined();
	});

	it("lists every newly ended service newest first, with no count cap of its own", () => {
		const ended = Array.from({ length: 11 }, (_, index) =>
			service({
				jobId: hexId(),
				name: `run-${index}`,
				stage: "COMPLETED",
				startedAt: ago(60 * MIN),
				endedAt: ago((20 - index) * MIN),
			})
		);
		const block = renderBlock({ services: ended });
		const rows = linesOf(block?.text).filter((line) => line.startsWith("- job"));
		expect(rows.map((row) => row.split(" · ")[0])).toEqual(
			[10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((index) => `- job run-${index}`)
		);
		expect(block?.ended).toHaveLength(11);
	});

	it("hands back only the ended rows it listed, so the ones the cap cut come up later", () => {
		const ended = Array.from({ length: 80 }, (_, index) =>
			service({
				jobId: hexId(),
				name: `run-${index}`,
				stage: "ERROR",
				startedAt: ago(90 * MIN),
				endedAt: ago((80 - index) * MIN),
			})
		);
		const block = renderBlock({ services: ended });
		const rows = linesOf(block?.text).filter((line) => line.startsWith("- job"));

		expect(rows.length).toBeGreaterThan(0);
		expect(rows.length).toBeLessThan(80);
		expect(linesOf(block?.text).at(-1)).toBe(`…and ${80 - rows.length} more`);
		const newestFirst = [...ended].reverse();
		expect(block?.ended).toEqual(
			newestFirst
				.slice(0, rows.length)
				.map(({ _id }) => ({ _id, stage: "ERROR", reported: "ERROR" }))
		);
	});

	it("marks a repo it only saw written to, and a file whose repo it never saw", () => {
		const block = render({
			artefacts: [
				artefact({ kind: "dataset", uri: "hf://datasets/ns/found", origin: "discovered" }),
				artefact({ kind: "file", uri: "hf://models/ns/other/README.md" }),
			],
		});
		expect(linesOf(block).slice(1)).toEqual([
			"Created on the Hub:",
			"- dataset ns/found (written to, not created by a call here)",
			"- file hf://models/ns/other/README.md",
		]);
	});

	it("says one file, not one files", () => {
		const block = render({
			artefacts: [artefact(), artefact({ kind: "file", uri: "hf://models/ns/qwen-sft/README.md" })],
		});
		expect(block).toContain("- model ns/qwen-sft (1 file)");
	});

	it("shortens a long job name but never an id or a file name", () => {
		const longName = "x".repeat(200);
		const block = render({
			services: [service({ name: longName })],
			files: [file({ name: `${"f".repeat(150)}.py` })],
		});
		expect(block).toContain(`- job ${"x".repeat(59)}… ·`);
		expect(block).toContain(`id ${JOB_ID}`);
		expect(block).toContain(`v-file://${"f".repeat(150)}.py`);
	});

	it("stays under the cap and still shows every section with a count of what it cut", () => {
		const open = Array.from({ length: 60 }, (_, index) =>
			service({ jobId: hexId(), name: `sweep-${index}`, flavor: "a10g-small" })
		);
		const ended = Array.from({ length: 12 }, () =>
			service({ jobId: hexId(), stage: "COMPLETED", endedAt: ago(MIN) })
		);
		const artefacts = Array.from({ length: 40 }, (_, index) =>
			artefact({ uri: `hf://models/ns/model-${index}`, createdAt: ago(index) })
		);
		const files = Array.from({ length: 40 }, (_, index) => file({ name: `script-${index}.py` }));

		const rendered = renderBlock({ services: [...open, ...ended], artefacts, files });
		const block = rendered?.text;
		const lines = linesOf(block);

		expect(block?.length).toBeLessThanOrEqual(SESSION_STATE_MAX_CHARS);
		expect(rendered?.ended).toEqual([]);
		const titles = [
			"Running and queued:",
			"Newly ended (listed once):",
			"Created on the Hub:",
			"Virtual files:",
		];
		const counts = [60, 12, 40, 40];
		titles.forEach((title, index) => {
			const start = lines.indexOf(title);
			expect(start).toBeGreaterThan(0);
			const end = index + 1 < titles.length ? lines.indexOf(titles[index + 1]) : lines.length;
			const section = lines.slice(start + 1, end);
			const shown = section.filter((line) => line.startsWith("- ")).length;
			expect(section.at(-1)).toBe(`…and ${counts[index] - shown} more`);
		});
	});

	it("fills to the cap rather than stopping well short of it", () => {
		const open = Array.from({ length: 60 }, (_, index) => service({ name: `sweep-${index}` }));
		const block = render({ services: open });
		expect(block?.length).toBeGreaterThan(SESSION_STATE_MAX_CHARS - 120);
	});
});

describe("injectSessionState", () => {
	const BLOCK = "[SESSION STATE — test]";

	it("appends to the last user message when its content is a string", () => {
		const messages: ChatCompletionMessageParam[] = [
			{ role: "system", content: "sys" },
			{ role: "user", content: "first" },
			{ role: "assistant", content: "reply" },
			{ role: "user", content: "second" },
		];
		const injected = injectSessionState(messages, BLOCK);
		expect(injected[3]).toEqual({ role: "user", content: `second\n\n${BLOCK}` });
		expect(injected[1]).toBe(messages[1]);
		expect(messages[3]).toEqual({ role: "user", content: "second" });
	});

	it("appends a text part when the content is an array", () => {
		const messages: ChatCompletionMessageParam[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "look at this" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
				],
			},
		];
		const injected = injectSessionState(messages, BLOCK);
		expect(injected[0]).toEqual({
			role: "user",
			content: [
				{ type: "text", text: "look at this" },
				{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
				{ type: "text", text: BLOCK },
			],
		});
	});

	it("leaves a history with no user message alone", () => {
		const messages: ChatCompletionMessageParam[] = [{ role: "system", content: "sys" }];
		expect(injectSessionState(messages, BLOCK)).toBe(messages);
	});
});

describe("mlStateBlockEnabled", () => {
	it("is on in the mode and off outside it", () => {
		expect(mlStateBlockEnabled({ mlAssistant: true })).toBe(true);
		expect(mlStateBlockEnabled({})).toBe(false);
	});
});

describe("buildSessionStateBlock", () => {
	const conv = { _id: new ObjectId(), mlAssistant: true };

	beforeAll(async () => {
		await ready;
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		mocks.virtualFiles.mockReset();
		mocks.virtualFiles.mockReturnValue(true);
		const filter = { conversationId: conv._id };
		await Promise.all([
			collections.mlServices.deleteMany(filter),
			collections.mlArtefacts.deleteMany(filter),
			collections.mlFiles.deleteMany(filter),
		]);
	});

	async function seed() {
		await collections.mlServices.insertOne(
			service({ conversationId: conv._id, name: "sft-smoke", startedAt: ago(3 * MIN) })
		);
		await collections.mlArtefacts.insertOne(artefact({ conversationId: conv._id }));
		await writeMlFileVersion({
			conversationId: conv._id,
			name: "train.py",
			content: "print(1)\n",
			origin: "write",
		});
	}

	it("reads the conversation's services, artefacts and files", async () => {
		await seed();
		const block = (await buildSessionStateBlock(conv, NOW))?.text;
		expect(block).toContain(`- job sft-smoke · RUNNING 3m 00s · id ${JOB_ID}`);
		expect(block).toContain("- model ns/qwen-sft");
		expect(block).toContain("- v-file://train.py v1 · 9 B");
	});

	it("leaves the files out when nothing would expand their references", async () => {
		mocks.virtualFiles.mockReturnValue(false);
		await seed();
		const block = (await buildSessionStateBlock(conv, NOW))?.text;
		expect(block).toContain("sft-smoke");
		expect(block).not.toContain("v-file://");
	});

	it("renders nothing for a conversation with an empty registry", async () => {
		expect(await buildSessionStateBlock(conv, NOW)).toBeUndefined();
	});

	it("returns nothing instead of throwing when a read fails", async () => {
		await seed();
		vi.spyOn(collections.mlArtefacts, "find").mockImplementation(() => {
			throw new Error("connection reset");
		});
		await expect(buildSessionStateBlock(conv, NOW)).resolves.toBeUndefined();
	});

	it("lists an ended job once, and not again after the block was read", async () => {
		await collections.mlServices.insertOne(
			service({ conversationId: conv._id, name: "sft-v1", stage: "ERROR", endedAt: ago(MIN) })
		);
		await collections.mlArtefacts.insertOne(artefact({ conversationId: conv._id }));

		const first = await buildSessionStateBlock(conv, NOW);
		expect(first?.text).toContain("- job sft-v1 · ERROR");
		await markSessionStateRead(first?.ended ?? []);

		const second = await buildSessionStateBlock(conv, NOW);
		expect(second?.text).not.toContain("sft-v1");
		expect(second?.text).toContain("- model ns/qwen-sft");
	});

	it("does not mark a row for a stage it has since left", async () => {
		const row = service({ conversationId: conv._id, name: "moved-on", stage: "COMPLETED" });
		await collections.mlServices.insertOne(row);

		await markSessionStateRead([{ _id: row._id, stage: "ERROR", reported: "ERROR" }]);

		expect(await collections.mlServices.findOne({ _id: row._id })).not.toHaveProperty(
			"lastReportedStage"
		);
		expect((await buildSessionStateBlock(conv, NOW))?.text).toContain("moved-on");
	});

	it("swallows a failed write so the turn goes on and the rows repeat", async () => {
		vi.spyOn(collections.mlServices, "bulkWrite").mockRejectedValue(new Error("write conflict"));
		await expect(
			markSessionStateRead([{ _id: new ObjectId(), stage: "ERROR", reported: "ERROR" }])
		).resolves.toBeUndefined();
	});

	it("takes an ended job out of the event path once the block has told the model", async () => {
		const row = service({
			conversationId: conv._id,
			name: "sft-v2",
			stage: "ERROR",
			endedAt: ago(MIN),
			eventPendingSince: ago(MIN),
		});
		await collections.mlServices.insertOne(row);

		const block = await buildSessionStateBlock(conv, NOW);
		expect(block?.text).toContain("- job sft-v2 · ERROR");
		await markSessionStateRead(block?.ended ?? []);

		const stored = await collections.mlServices.findOne({ _id: row._id });
		expect(stored?.lastReportedStage).toBe("ERROR");
		expect(stored).not.toHaveProperty("eventPendingSince");
		expect(await claimServiceEvents(conv._id, NOW)).toEqual([]);
	});

	it("reports a row the poller gave up on once, even when its running stage was already told", async () => {
		const row = service({
			conversationId: conv._id,
			name: "gave-up",
			lastReportedStage: "RUNNING",
			pollStoppedReason: "past its timeout with no usable Hub token",
		});
		await collections.mlServices.insertOne(row);

		const first = await buildSessionStateBlock(conv, NOW);
		expect(first?.text).toContain("- job gave-up · no longer tracked, last seen RUNNING");
		await markSessionStateRead(first?.ended ?? []);

		expect((await collections.mlServices.findOne({ _id: row._id }))?.lastReportedStage).toBe(
			"UNTRACKED"
		);
		expect(await buildSessionStateBlock(conv, NOW)).toBeUndefined();
	});
});
