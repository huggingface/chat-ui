import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { SESSION_LABEL_KEY } from "$lib/server/mcp/jobLabels";
import type { MlService } from "$lib/types/MlService";
import type { MlSessionLabel } from "$lib/types/MlSessionLabel";
import { claimDueService } from "./poller";
import { claimDueReconcile, reconcileSession } from "./reconcile";
import { loadSessionJobLabels, markLabelledSubmission, RECONCILE_DELAY_MS } from "./sessionLabel";
import { listMlServices, recordDiscoveredService, recordDispatchedService } from "./store";

beforeAll(async () => {
	await ready;
});

const conversationIds: ObjectId[] = [];

afterEach(async () => {
	vi.unstubAllGlobals();
	await collections.mlServices.deleteMany({ conversationId: { $in: conversationIds } });
	await collections.mlSessionLabels.deleteMany({ _id: { $in: conversationIds } });
	conversationIds.length = 0;
});

const NOW = new Date("2026-09-25T12:00:00Z");
const MINUTE = 60_000;
const TOKEN = "hf_test";
const LOST_JOB = "0123456789abcdef01234567";
const KNOWN_JOB = "fedcbafedcbafedcbafedcba";
const READ_JOB = "abcdefabcdefabcdefabcdef";

const listedJob = (id: string, stage: string, labels: Record<string, string> = {}) => ({
	id,
	createdAt: "2026-09-25T11:58:00.000Z",
	status: { stage, message: null },
	owner: { id: "u1", name: "acme", type: "org" },
	flavor: "t4-small",
	labels,
	timeout_seconds: 3600,
});

function stubListing(jobs: unknown[] | { offline: true }) {
	const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
		if (!Array.isArray(jobs)) throw new Error("offline");
		return { ok: true, status: 200, headers: new Headers(), json: async () => jobs };
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

async function submittedSession(at = NOW): Promise<{ conversationId: ObjectId; session: string }> {
	const conversationId = new ObjectId();
	conversationIds.push(conversationId);
	const { session } = await loadSessionJobLabels(conversationId);
	await markLabelledSubmission({
		conversationId,
		namespace: "acme",
		timeoutSeconds: 3600,
		now: at,
	});
	return { conversationId, session };
}

async function claimAt(at: Date): Promise<MlSessionLabel> {
	const claimed = await claimDueReconcile(at);
	if (!claimed) throw new Error(`nothing due at ${at.toISOString()}`);
	return claimed;
}

async function readRow(conversationId: ObjectId, jobId: string): Promise<MlService> {
	const row = await collections.mlServices.findOne({ conversationId, jobId });
	if (!row) throw new Error(`no row for ${jobId}`);
	return row;
}

describe.sequential("mlRegistry reconcile: what it records", () => {
	it("records a labelled job the registry never heard of, once, and the poller picks it up", async () => {
		const { conversationId, session } = await submittedSession();
		const fetchMock = stubListing([
			listedJob(LOST_JOB, "RUNNING", { name: "ml-intern-sft", [SESSION_LABEL_KEY]: "x" }),
		]);
		const at = new Date(NOW.getTime() + RECONCILE_DELAY_MS);

		expect(await reconcileSession(await claimAt(at), TOKEN, at)).toBe(1);

		const url = new URL(String(fetchMock.mock.calls[0][0]));
		expect(url.pathname).toBe("/api/jobs/acme");
		expect(url.searchParams.getAll("label")).toEqual([`${SESSION_LABEL_KEY}=${session}`]);
		expect(await readRow(conversationId, LOST_JOB)).toMatchObject({
			kind: "job",
			namespace: "acme",
			stage: "RUNNING",
			origin: "dispatched",
			reconciled: true,
			name: "ml-intern-sft",
			flavor: "t4-small",
			timeoutSeconds: 3600,
			createdAt: new Date("2026-09-25T11:58:00.000Z"),
			hubUrl: `https://huggingface.co/jobs/acme/${LOST_JOB}`,
		});
		expect(await readRow(conversationId, LOST_JOB)).not.toHaveProperty("reservationKey");
		expect((await claimDueService(new Date()))?.jobId).toBe(LOST_JOB);

		await markLabelledSubmission({
			conversationId,
			namespace: "acme",
			timeoutSeconds: 60,
			now: at,
		});
		const later = new Date(at.getTime() + RECONCILE_DELAY_MS);
		expect(await reconcileSession(await claimAt(later), TOKEN, later)).toBe(0);
		expect(await listMlServices(conversationId)).toHaveLength(1);
	});

	it("leaves every row it already knows as it is", async () => {
		const { conversationId } = await submittedSession();
		await recordDispatchedService({
			conversationId,
			kind: "job",
			jobId: KNOWN_JOB,
			namespace: "acme",
			stage: "SCHEDULING",
			name: "ml-intern-known",
			reservationKey: "gen:call-1",
		});
		await recordDiscoveredService({
			conversationId,
			kind: "job",
			jobId: READ_JOB,
			namespace: "acme",
		});
		const before = await listMlServices(conversationId);
		stubListing([
			listedJob(KNOWN_JOB, "RUNNING", { name: "renamed-on-the-hub" }),
			listedJob(READ_JOB, "COMPLETED"),
		]);
		const at = new Date(NOW.getTime() + RECONCILE_DELAY_MS);

		expect(await reconcileSession(await claimAt(at), TOKEN, at)).toBe(0);
		expect(await listMlServices(conversationId)).toEqual(before);
	});

	it("puts an ended job in unread, so the poller's first read records the end", async () => {
		const { conversationId } = await submittedSession();
		stubListing([listedJob(LOST_JOB, "COMPLETED")]);
		const at = new Date(NOW.getTime() + RECONCILE_DELAY_MS);

		await reconcileSession(await claimAt(at), TOKEN, at);
		expect((await readRow(conversationId, LOST_JOB)).stage).toBe("UNKNOWN");
	});

	it("clears the flag once the submit reply turns up after all", async () => {
		const { conversationId } = await submittedSession();
		stubListing([listedJob(LOST_JOB, "RUNNING")]);
		const at = new Date(NOW.getTime() + RECONCILE_DELAY_MS);
		await reconcileSession(await claimAt(at), TOKEN, at);

		await recordDispatchedService({
			conversationId,
			kind: "job",
			jobId: LOST_JOB,
			namespace: "acme",
			stage: "RUNNING",
			reservationKey: "gen:call-1",
		});
		const row = await readRow(conversationId, LOST_JOB);
		expect(row).not.toHaveProperty("reconciled");
		expect(row.reservationKey).toBe("gen:call-1");
	});
});

describe.sequential("mlRegistry reconcile: when it runs", () => {
	it("waits out the delay after a submission, and once listed is not due again", async () => {
		const { conversationId } = await submittedSession();
		stubListing([]);

		expect(
			await claimDueReconcile(new Date(NOW.getTime() + RECONCILE_DELAY_MS - MINUTE))
		).toBeNull();
		const at = new Date(NOW.getTime() + RECONCILE_DELAY_MS);
		await reconcileSession(await claimAt(at), TOKEN, at);

		const row = await collections.mlSessionLabels.findOne({ _id: conversationId });
		expect(row).not.toHaveProperty("reconcileAt");
		expect(row?.reconciledAt).toEqual(at);
		expect(await claimDueReconcile(new Date(at.getTime() + 60 * MINUTE))).toBeNull();
	});

	it("gives one listing to a burst of submissions", async () => {
		const { conversationId } = await submittedSession();
		for (let i = 1; i <= 3; i++) {
			await markLabelledSubmission({
				conversationId,
				namespace: "acme",
				timeoutSeconds: 3600,
				now: new Date(NOW.getTime() + i * MINUTE),
			});
		}
		const fetchMock = stubListing([]);
		const at = new Date(NOW.getTime() + RECONCILE_DELAY_MS);
		await reconcileSession(await claimAt(at), TOKEN, at);
		expect(await claimDueReconcile(new Date(at.getTime() + 60 * MINUTE))).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("keeps a submission made mid-reconcile due, no sooner than the delay after the claim", async () => {
		const { conversationId } = await submittedSession();
		stubListing([]);
		const at = new Date(NOW.getTime() + RECONCILE_DELAY_MS);
		const claimed = await claimAt(at);
		await markLabelledSubmission({
			conversationId,
			namespace: "acme",
			timeoutSeconds: 3600,
			now: new Date(at.getTime() + 1000),
		});
		await reconcileSession(claimed, TOKEN, at);

		expect(await claimDueReconcile(new Date(at.getTime() + RECONCILE_DELAY_MS - 1000))).toBeNull();
		expect(await claimDueReconcile(new Date(at.getTime() + RECONCILE_DELAY_MS))).not.toBeNull();
	});

	it("skips a session with no token and tries again after the delay", async () => {
		await submittedSession();
		const fetchMock = stubListing([]);
		const at = new Date(NOW.getTime() + RECONCILE_DELAY_MS);

		expect(await reconcileSession(await claimAt(at), undefined, at)).toBe(0);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(await claimDueReconcile(new Date(at.getTime() + RECONCILE_DELAY_MS))).not.toBeNull();
	});

	it("tries a failed listing again", async () => {
		await submittedSession();
		stubListing({ offline: true });
		const at = new Date(NOW.getTime() + RECONCILE_DELAY_MS);

		await reconcileSession(await claimAt(at), TOKEN, at);
		expect(await claimDueReconcile(new Date(at.getTime() + RECONCILE_DELAY_MS))).not.toBeNull();
	});

	it("stops once no submission could still be running", async () => {
		const { conversationId } = await submittedSession();
		const fetchMock = stubListing([]);
		const at = new Date(NOW.getTime() + 24 * 60 * MINUTE);

		await reconcileSession(await claimAt(at), TOKEN, at);
		expect(fetchMock).not.toHaveBeenCalled();
		const row = await collections.mlSessionLabels.findOne({ _id: conversationId });
		expect(row).not.toHaveProperty("reconcileAt");
		expect(row).not.toHaveProperty("reconciledAt");
	});
});

describe.sequential("mlRegistry session label", () => {
	it("draws the value once and hands back the conversation's own jobs", async () => {
		const conversationId = new ObjectId();
		conversationIds.push(conversationId);
		const first = await loadSessionJobLabels(conversationId);
		expect(first.session).toMatch(/^[0-9a-f]{16}$/);

		await recordDispatchedService({
			conversationId,
			kind: "job",
			jobId: KNOWN_JOB,
			namespace: "acme",
			stage: "RUNNING",
			name: "ml-intern-known",
		});
		await recordDiscoveredService({
			conversationId,
			kind: "job",
			jobId: READ_JOB,
			namespace: "acme",
		});

		const second = await loadSessionJobLabels(conversationId);
		expect(second.session).toBe(first.session);
		expect([...second.ownJobs]).toEqual([[KNOWN_JOB, "ml-intern-known"]]);
	});
});
