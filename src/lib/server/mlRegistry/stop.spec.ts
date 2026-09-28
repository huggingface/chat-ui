import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import type { MlService } from "$lib/types/MlService";
import type { TurnStatus } from "$lib/types/TurnState";

const pinned = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("$lib/server/mlAssistant", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/mlAssistant")>()),
	pinnedHubToken: () => pinned.token,
}));

const { stopSandbox } = await import("./stop");

beforeAll(async () => {
	await ready;
});

const conversationIds: ObjectId[] = [];

afterEach(async () => {
	pinned.token = undefined;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	await collections.mlServices.deleteMany({ conversationId: { $in: conversationIds } });
	await collections.turnStates.deleteMany({ conversationId: { $in: conversationIds } });
	conversationIds.length = 0;
});

const NOW = new Date("2026-09-28T12:00:00Z");
const MINUTE = 60_000;
const TOKEN = "hf_request";

let nextJob = 0;
const jobId = () => (nextJob++).toString(16).padStart(24, "a");

function newConversation(): ObjectId {
	const id = new ObjectId();
	conversationIds.push(id);
	return id;
}

async function insertSandbox(
	conversationId: ObjectId,
	overrides: Partial<MlService> = {}
): Promise<MlService> {
	const id = overrides.jobId ?? jobId();
	const service: MlService = {
		_id: new ObjectId(),
		conversationId,
		kind: "sandbox",
		jobId: id,
		namespace: "testuser",
		handle: `hfsb2:testuser:${id}`,
		stage: "RUNNING",
		origin: "dispatched",
		hubUrl: `https://huggingface.co/jobs/testuser/${id}`,
		flavor: "cpu-basic",
		timeoutSeconds: 3600,
		startedAt: new Date(NOW.getTime() - 30 * MINUTE),
		createdAt: new Date(NOW.getTime() - 31 * MINUTE),
		updatedAt: NOW,
		nextPollAt: new Date(NOW.getTime() + 20_000),
		...overrides,
	};
	await collections.mlServices.insertOne(service);
	return service;
}

async function insertTurn(conversationId: ObjectId, status: TurnStatus): Promise<void> {
	await collections.turnStates.insertOne({
		_id: new ObjectId(),
		conversationId,
		messageId: `msg-${status}`,
		status,
		producerId: "gen-1",
		createdAt: NOW,
		updatedAt: NOW,
	});
}

function stubCancel(response: { ok: boolean; status: number } | "throw") {
	const fetchMock = vi.fn(async () => {
		if (response === "throw") throw new Error("socket hang up");
		return response;
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

async function readService(id: ObjectId): Promise<MlService> {
	const row = await collections.mlServices.findOne({ _id: id });
	if (!row) throw new Error(`service ${id.toString()} is gone`);
	return row;
}

const stop = (conversationId: ObjectId, service: MlService, requestToken: string | undefined) =>
	stopSandbox({ conversationId, serviceId: service._id, requestToken, now: NOW });

describe.sequential("stopSandbox", () => {
	it("cancels the sandbox on the Hub with the request token and marks the row", async () => {
		const conversationId = newConversation();
		const service = await insertSandbox(conversationId);
		const fetchMock = stubCancel({ ok: true, status: 200 });

		expect(await stop(conversationId, service, TOKEN)).toEqual({ ok: true });

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(`https://huggingface.co/api/jobs/testuser/${service.jobId}/cancel`);
		expect(init.method).toBe("POST");
		expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
		const row = await readService(service._id);
		expect(row.stopRequestedAt).toEqual(NOW);
		expect(row.stage).toBe("RUNNING");
	});

	it("stops it as the pinned account when one is configured", async () => {
		pinned.token = "hf_pinned";
		const conversationId = newConversation();
		const service = await insertSandbox(conversationId);
		const fetchMock = stubCancel({ ok: true, status: 200 });

		await stop(conversationId, service, TOKEN);

		const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(init.headers).toEqual({ Authorization: "Bearer hf_pinned" });
	});

	it("refuses while a turn is running and leaves the row alone", async () => {
		const conversationId = newConversation();
		const service = await insertSandbox(conversationId);
		await insertTurn(conversationId, "running");
		const fetchMock = stubCancel({ ok: true, status: 200 });

		const outcome = await stop(conversationId, service, TOKEN);

		expect(outcome).toMatchObject({ ok: false, status: 409 });
		expect(fetchMock).not.toHaveBeenCalled();
		expect((await readService(service._id)).stopRequestedAt).toBeUndefined();
	});

	it("marks the row before it looks for a running turn, so a turn starting after the look sees the mark", async () => {
		const conversationId = newConversation();
		const service = await insertSandbox(conversationId);
		stubCancel({ ok: true, status: 200 });
		let markWhenChecked: Date | undefined;
		const count = collections.turnStates.countDocuments.bind(collections.turnStates);
		vi.spyOn(collections.turnStates, "countDocuments").mockImplementation(async (...args) => {
			markWhenChecked = (await readService(service._id)).stopRequestedAt;
			return count(...args);
		});

		expect(await stop(conversationId, service, TOKEN)).toEqual({ ok: true });
		expect(markWhenChecked).toEqual(NOW);
	});

	it("stops it while the turn is parked on a wait or a question", async () => {
		for (const status of ["waiting", "awaiting_input", "done"] as const) {
			const conversationId = newConversation();
			const service = await insertSandbox(conversationId);
			await insertTurn(conversationId, status);
			stubCancel({ ok: true, status: 200 });

			expect(await stop(conversationId, service, TOKEN)).toEqual({ ok: true });
		}
	});

	it("only stops a sandbox this conversation created and that is still open", async () => {
		const conversationId = newConversation();
		const cases: [Partial<MlService>, number][] = [
			[{ kind: "job" }, 404],
			[{ origin: "discovered" }, 409],
			[{ stage: "CANCELED" }, 409],
			[{ pollStoppedReason: "past its timeout and the last lookup failed" }, 409],
		];
		const fetchMock = stubCancel({ ok: true, status: 200 });
		for (const [overrides, status] of cases) {
			const service = await insertSandbox(conversationId, overrides);
			expect(await stop(conversationId, service, TOKEN)).toMatchObject({ ok: false, status });
		}

		const elsewhere = await insertSandbox(newConversation());
		expect(await stop(conversationId, elsewhere, TOKEN)).toMatchObject({ ok: false, status: 404 });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("asks the user to sign in again when there is no token to stop it with", async () => {
		const conversationId = newConversation();
		const service = await insertSandbox(conversationId);
		const fetchMock = stubCancel({ ok: true, status: 200 });

		expect(await stop(conversationId, service, undefined)).toMatchObject({
			ok: false,
			status: 403,
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("takes the mark back when the Hub refuses or cannot be reached", async () => {
		const conversationId = newConversation();
		for (const response of [{ ok: false, status: 403 }, "throw"] as const) {
			const service = await insertSandbox(conversationId);
			stubCancel(response);

			expect(await stop(conversationId, service, TOKEN)).toMatchObject({
				ok: false,
				status: 502,
			});
			expect((await readService(service._id)).stopRequestedAt).toBeUndefined();
		}
	});

	it("answers a repeat stop without asking the Hub again, so it cannot take the mark back", async () => {
		const conversationId = newConversation();
		const firstMark = new Date(NOW.getTime() - 5_000);
		const service = await insertSandbox(conversationId, { stopRequestedAt: firstMark });
		const fetchMock = stubCancel({ ok: false, status: 409 });

		expect(await stop(conversationId, service, TOKEN)).toEqual({ ok: true });
		expect(fetchMock).not.toHaveBeenCalled();
		expect((await readService(service._id)).stopRequestedAt).toEqual(firstMark);
	});

	it("counts a sandbox the Hub no longer has as stopped", async () => {
		const conversationId = newConversation();
		const service = await insertSandbox(conversationId);
		stubCancel({ ok: false, status: 404 });

		expect(await stop(conversationId, service, TOKEN)).toEqual({ ok: true });
		expect((await readService(service._id)).stopRequestedAt).toEqual(NOW);
	});
});
