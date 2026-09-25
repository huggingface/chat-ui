import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import type { MlService, ServiceEvent } from "$lib/types/MlService";
import { createWaitTool, waitResumeResultText } from "./waitTool";
import type { BuiltinToolContext } from "./types";

const waitBuiltin = createWaitTool({ serviceEvents: false });
const JOB_ID = "0123456789abcdef01234567";

const ctx = (over: Partial<BuiltinToolContext> = {}): BuiltinToolContext => ({
	uuid: "uuid-1",
	toolCallId: "call-1",
	conversationId: new ObjectId(),
	messageId: "msg-1",
	userId: new ObjectId(),
	sessionId: "sess-1",
	...over,
});

beforeAll(async () => {
	await ready;
});

afterEach(async () => {
	await collections.parkedCalls.deleteMany({});
	await collections.mlServices.deleteMany({ jobId: JOB_ID });
});

async function insertUnreportedEnd(conversationId: ObjectId): Promise<MlService> {
	const now = new Date();
	const service: MlService = {
		_id: new ObjectId(),
		conversationId,
		kind: "job",
		jobId: JOB_ID,
		namespace: "testuser",
		name: "sft-smoke",
		flavor: "a10g-small",
		stage: "ERROR",
		stageBeforeEnd: "RUNNING",
		origin: "dispatched",
		hubUrl: `https://huggingface.co/jobs/testuser/${JOB_ID}`,
		startedAt: new Date(now.getTime() - 137_000),
		endedAt: now,
		eventPendingSince: now,
		createdAt: now,
		updatedAt: now,
	};
	await collections.mlServices.insertOne(service);
	return service;
}

describe("the wait tool", () => {
	it("parks the turn and records everything a resume needs", async () => {
		const c = ctx();
		const before = Date.now();

		const outcome = await waitBuiltin.execute({ seconds: 120, reason: "job to finish" }, c);

		expect(outcome).toEqual({ awaitingInput: true });
		const row = await collections.parkedCalls.findOne({});
		expect(row).toMatchObject({
			conversationId: c.conversationId,
			messageId: "msg-1",
			toolCallId: "call-1",
			toolUuid: "uuid-1",
			kind: "timer",
			status: "waiting",
			reason: "job to finish",
			userId: c.userId,
			sessionId: "sess-1",
			attempts: 0,
		});
		// The identity matters as much as the timer: a resume has no request to read
		// one from, and must act as the user who parked.
		expect(row?.resumeAt.getTime()).toBeGreaterThanOrEqual(before + 120_000);
	});

	it("clamps a wait to the allowed window rather than refusing it", async () => {
		const waitedFor = async () => {
			const row = await collections.parkedCalls.findOne({});
			if (!row) throw new Error("nothing parked");
			return row.resumeAt.getTime() - row.createdAt.getTime();
		};

		await waitBuiltin.execute({ seconds: 5, reason: "too short" }, ctx());
		expect(await waitedFor()).toBeGreaterThanOrEqual(15_000);

		await collections.parkedCalls.deleteMany({});
		await waitBuiltin.execute({ seconds: 99_999, reason: "too long" }, ctx());
		expect(await waitedFor()).toBeLessThanOrEqual(30 * 60_000);
	});

	it("refuses without saying what it is waiting for", async () => {
		const outcome = await waitBuiltin.execute({ seconds: 60 }, ctx());
		expect(outcome).toHaveProperty("error");
		expect(await collections.parkedCalls.countDocuments({})).toBe(0);
	});

	it("stops a wait-loop from replacing the poll-loop", async () => {
		// Park, resume, park again costs a turn each time and never returns to the
		// user. This is the same ceiling the repetition guard puts on tool calls.
		const conversationId = new ObjectId();
		await collections.parkedCalls.insertMany(
			Array.from({ length: 100 }, () => ({
				_id: new ObjectId(),
				parkedCallId: new ObjectId().toString(),
				conversationId,
				messageId: "m",
				toolCallId: "c",
				toolUuid: "u",
				kind: "timer" as const,
				status: "resumed" as const,
				resumeAt: new Date(),
				reason: "prior hop",
				attempts: 1,
				createdAt: new Date(),
				updatedAt: new Date(),
			}))
		);

		const outcome = await waitBuiltin.execute(
			{ seconds: 60, reason: "again" },
			ctx({ conversationId })
		);

		expect(outcome).toHaveProperty("error");
		expect(String((outcome as { error: string }).error)).toContain("limit");
		expect(await collections.parkedCalls.countDocuments({ conversationId })).toBe(100);
	});

	it("declines to park where nothing could wake it", async () => {
		const outcome = await waitBuiltin.execute(
			{ seconds: 60, reason: "x" },
			ctx({ conversationId: undefined })
		);
		expect(outcome).toHaveProperty("error");
		expect(await collections.parkedCalls.countDocuments({})).toBe(0);
	});
});

describe("the wait tool with service events", () => {
	const watched = createWaitTool({ serviceEvents: true });

	it("returns at once with a job that already ended, and hands the event over once", async () => {
		const c = ctx();
		if (!c.conversationId) throw new Error("no conversation");
		const service = await insertUnreportedEnd(c.conversationId);

		const outcome = await watched.execute({ seconds: 1200, reason: "the smoke job" }, c);

		expect(outcome).toHaveProperty("resultText");
		const text = String((outcome as { resultText: string }).resultText);
		expect(text).toContain("Did not wait");
		expect(text).toContain(
			`Job sft-smoke (a10g-small, id ${JOB_ID}) failed: ERROR after 2m17s. ` +
				"Read its logs with check_job before changing anything."
		);
		expect(await collections.parkedCalls.countDocuments({})).toBe(0);
		const row = await collections.mlServices.findOne({ _id: service._id });
		expect(row?.eventPendingSince).toBeUndefined();
		expect(row?.lastReportedStage).toBe("ERROR");

		expect(await watched.execute({ seconds: 1200, reason: "the real run" }, c)).toEqual({
			awaitingInput: true,
		});
		expect(await collections.parkedCalls.countDocuments({})).toBe(1);
	});

	it("parks as before when nothing has ended", async () => {
		const outcome = await watched.execute({ seconds: 1200, reason: "the real run" }, ctx());
		expect(outcome).toEqual({ awaitingInput: true });
		expect(await collections.parkedCalls.countDocuments({})).toBe(1);
	});

	it("leaves pending events alone when events are off", async () => {
		const c = ctx();
		if (!c.conversationId) throw new Error("no conversation");
		const service = await insertUnreportedEnd(c.conversationId);

		const outcome = await waitBuiltin.execute({ seconds: 120, reason: "the smoke job" }, c);

		expect(outcome).toEqual({ awaitingInput: true });
		const row = await collections.mlServices.findOne({ _id: service._id });
		expect(row?.eventPendingSince).toBeInstanceOf(Date);
	});
});

describe("the wait guidance", () => {
	const secondsDescription = (serviceEvents: boolean) => {
		const { parameters } = createWaitTool({ serviceEvents }).definition.function;
		return JSON.stringify(parameters);
	};

	it("asks for a short first wait only where nothing wakes a parked turn", () => {
		expect(secondsDescription(false)).toContain("Check early, then stretch");
		expect(createWaitTool({ serviceEvents: false }).preprompt).toContain(
			"Ask for a delay that matches the work"
		);
	});

	it("sizes waits for the work when the harness wakes the turn on an end", () => {
		const description = secondsDescription(true);
		expect(description).toContain("wakes you the moment one ends or fails");
		expect(description).toContain("You do not need short first waits");
		expect(description).not.toContain("Check early");
		const preprompt = createWaitTool({ serviceEvents: true }).preprompt ?? "";
		expect(preprompt).toContain("wakes you the moment one ends or fails");
		expect(preprompt).not.toContain("Ask for a delay that matches the work,");
	});
});

describe("the tool result a resumed turn reads", () => {
	const park = { reason: "the training job", createdAt: new Date(0), resumeAt: new Date(120_000) };

	it("reports the wait it actually served", () => {
		const text = waitResumeResultText(park);
		expect(text).toContain("Waited 120s for: the training job.");
		expect(text).not.toContain("user asked");
	});

	it("names the wait the user skipped, so the model does not stretch the next one", () => {
		// Resumed after 12s of a 300s wait, at the user's request.
		const text = waitResumeResultText({
			...park,
			resumeAt: new Date(12_000),
			wokeEarlyAt: new Date(12_000),
			plannedResumeAt: new Date(300_000),
		});
		expect(text).toContain("Waited 12s");
		expect(text).toContain("cutting short a 300s wait");
		expect(text).toContain("size any further wait as you would have without this check");
	});

	it("still says the wait was cut short when the original deadline was not recorded", () => {
		const text = waitResumeResultText({ ...park, wokeEarlyAt: new Date(120_000) });
		expect(text).toContain("cutting short the wait");
	});

	describe("after a job or sandbox ended", () => {
		const event = (over: Partial<ServiceEvent> = {}): ServiceEvent => ({
			serviceId: new ObjectId(),
			kind: "job",
			jobId: JOB_ID,
			name: "sft-smoke",
			flavor: "a10g-small",
			from: "RUNNING",
			to: "ERROR",
			ranSeconds: 137,
			at: new Date(137_000),
			...over,
		});
		const woken = (...serviceEvents: ServiceEvent[]) =>
			waitResumeResultText({
				...park,
				resumeAt: new Date(137_000),
				plannedResumeAt: new Date(1_200_000),
				wokeByHarnessAt: new Date(137_000),
				serviceEvents,
			});

		it("names the harness as the reason the wait was cut short", () => {
			const text = woken(event());
			expect(text).toContain("Waited 137s for: the training job.");
			expect(text).toContain(
				"You were woken early, cutting short a 1200s wait, because a job you started " +
					"changed state; the short gap says nothing else about the work."
			);
			expect(text).not.toContain("user asked");
		});

		it("says each stage in fixed words, status only, ending in what to do", () => {
			expect(woken(event())).toContain(
				`Job sft-smoke (a10g-small, id ${JOB_ID}) failed: ERROR after 2m17s. ` +
					"Read its logs with check_job before changing anything."
			);
			expect(woken(event({ to: "COMPLETED", ranSeconds: 4320 }))).toContain(
				`Job sft-smoke (a10g-small, id ${JOB_ID}) completed after 1h12m. ` +
					"Confirm the result and that its outputs were pushed with check_job before reporting it."
			);
			expect(woken(event({ to: "CANCELED", ranSeconds: 45 }))).toContain(
				`Job sft-smoke (a10g-small, id ${JOB_ID}) was cancelled after 45s. ` +
					"If you did not cancel it, read its logs with check_job to find out why."
			);
			expect(woken(event({ to: "DELETED", ranSeconds: 120 }))).toContain(
				`Job sft-smoke (a10g-small, id ${JOB_ID}) is gone after 2m: the Hub no longer has it.`
			);
		});

		it("names an unnamed job by its id and leaves out a run time it never had", () => {
			expect(
				woken(
					event({ name: undefined, flavor: undefined, ranSeconds: undefined, from: "SCHEDULING" })
				)
			).toContain(`Job ${JOB_ID} failed: ERROR. Read its logs`);
		});

		it("tells the model a stopped sandbox is gone", () => {
			const text = woken(
				event({
					kind: "sandbox",
					name: undefined,
					handle: `hfsb2:testuser:${JOB_ID}`,
					flavor: "a100-large",
					to: "ERROR",
					ranSeconds: 3600,
				})
			);
			expect(text).toContain(
				`Sandbox hfsb2:testuser:${JOB_ID} (a100-large) stopped: ERROR after 1h. ` +
					"Create a new one if you still need it."
			);
			expect(text).toContain("because a sandbox you started changed state");
		});

		it("lists every event the wake carries", () => {
			const text = woken(event(), event({ jobId: "fedcbafedcbafedcbafedcba", name: "sft-full" }));
			expect(text).toContain("because jobs you started changed state");
			expect(text).toContain("Job sft-smoke");
			expect(text).toContain("Job sft-full");
		});

		it("keeps the user's wording when the user woke the turn first", () => {
			const text = waitResumeResultText({
				...park,
				resumeAt: new Date(12_000),
				wokeEarlyAt: new Date(12_000),
				plannedResumeAt: new Date(300_000),
				serviceEvents: [event()],
			});
			expect(text).toContain("The user asked you to check early, cutting short a 300s wait.");
			expect(text).not.toContain("You were woken early");
			expect(text).toContain("Job sft-smoke");
		});

		it("carries events into a wait that ran its course without calling it early", () => {
			const text = waitResumeResultText({ ...park, serviceEvents: [event()] });
			expect(text).toContain("Waited 120s for: the training job.");
			expect(text).not.toContain("woken early");
			expect(text).toContain("failed: ERROR after 2m17s");
		});
	});
});
