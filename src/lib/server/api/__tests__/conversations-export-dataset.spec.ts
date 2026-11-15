import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import {
	cleanupTestData,
	createTestConversation,
	createTestLocals,
	createTestUser,
} from "./testHelpers";

vi.mock("$lib/utils/mlAssistantFlag", () => ({ ML_ASSISTANT_MODE: true }));
vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));
vi.mock("$lib/server/apiToken", () => ({
	getUserHubWriteToken: (locals: App.Locals) => locals.token,
}));
vi.mock("@huggingface/hub", async (importOriginal) => ({
	...(await importOriginal<typeof import("@huggingface/hub")>()),
	commit: vi.fn(),
	createRepo: vi.fn(async () => ({ repoUrl: "" })),
	datasetInfo: vi.fn(),
	fileExists: vi.fn(async () => true),
}));

const hub = await import("@huggingface/hub");
const { HubApiError } = hub;
const { POST } =
	await import("../../../../routes/api/v2/conversations/[id]/export/dataset/+server");

const hubError = (status: number) => new HubApiError("https://huggingface.co/api/x", status);

const push = (locals: App.Locals, id: string, body: unknown) =>
	POST({
		locals,
		params: { id },
		request: new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }),
	} as never) as Promise<Response>;

async function expectStatus(promise: Promise<Response>, status: number, message?: string) {
	try {
		await promise;
		expect.fail("Should have thrown");
	} catch (e: unknown) {
		expect((e as { status: number }).status).toBe(status);
		if (message) expect((e as { body: { message: string } }).body.message).toContain(message);
	}
}

async function signedIn() {
	const test = await createTestUser();
	return { ...test, locals: { ...test.locals, token: "hf_user" } };
}

beforeAll(async () => {
	await ready;
});

describe.sequential("POST /api/v2/conversations/[id]/export/dataset", () => {
	beforeEach(() => {
		vi.mocked(hub.commit).mockReset();
		vi.mocked(hub.commit).mockResolvedValue(undefined as never);
		vi.mocked(hub.createRepo).mockClear();
		vi.mocked(hub.datasetInfo).mockReset();
		vi.mocked(hub.datasetInfo).mockResolvedValue({ private: true } as never);
	});

	afterEach(async () => {
		await cleanupTestData();
	});

	it("throws 401 without a session", async () => {
		const locals = createTestLocals({ sessionId: undefined, user: undefined });
		await expectStatus(push(locals, new ObjectId().toString(), { repo: "a/b" }), 401);
	});

	it("pushes a conversation outside ML Intern too", async () => {
		const { locals } = await signedIn();
		const conv = await createTestConversation(locals);
		const res = await push(locals, conv._id.toString(), { repo: "a/b" });
		expect(res.status).toBe(200);
		expect(hub.commit).toHaveBeenCalledTimes(1);
	});

	it("403s a sign-in that cannot write to the Hub", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		await expectStatus(push(locals, conv._id.toString(), { repo: "a/b" }), 403, "cannot write");
	});

	it.each(["nope", "../models", "a/..", "a/b..c", "../.."])("400s the repo %s", async (repo) => {
		const { locals } = await signedIn();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		await expectStatus(push(locals, conv._id.toString(), { repo }), 400, "owner/name");
	});

	it.each([
		"https://huggingface.co/datasets/alice/traces/",
		"https://hf.co/datasets/alice/traces",
		"datasets/alice/traces",
		" alice/traces/ ",
	])("reads the pasted repo %s as alice/traces", async (repo) => {
		const { locals } = await signedIn();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		const res = await push(locals, conv._id.toString(), { repo });
		expect((await res.json()).repo).toBe("alice/traces");
	});

	it("commits the session trace to <last 8 of id>.jsonl with the user token", async () => {
		const { locals } = await signedIn();
		const conv = await createTestConversation(locals, {
			mlAssistant: true,
			title: "Fine-tune SmolLM",
		});
		const res = await push(locals, conv._id.toString(), { repo: "alice/hf-chat-traces" });

		const path = `${conv._id.toString().slice(-8)}.jsonl`;
		expect(await res.json()).toEqual({
			repo: "alice/hf-chat-traces",
			path,
			url: `https://huggingface.co/datasets/alice/hf-chat-traces/blob/main/${path}`,
			created: false,
			private: true,
		});
		const call = vi.mocked(hub.commit).mock.calls[0][0];
		expect(call).toMatchObject({
			repo: { type: "dataset", name: "alice/hf-chat-traces" },
			accessToken: "hf_user",
		});
		const [operation] = call.operations;
		expect(operation).toMatchObject({ operation: "addOrUpdate", path });
		const [header] = (await (operation as { content: Blob }).content.text())
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(header).toMatchObject({
			type: "session",
			harness: "chat-ui",
			id: conv._id.toString(),
			name: "Fine-tune SmolLM",
		});
		// the dataset already has a card
		expect(call.operations).toHaveLength(1);
		expect(hub.createRepo).not.toHaveBeenCalled();
	});

	it("adds the trace viewer card to a dataset that has none", async () => {
		const { locals } = await signedIn();
		const conv = await createTestConversation(locals);
		vi.mocked(hub.fileExists).mockResolvedValueOnce(false);

		await push(locals, conv._id.toString(), { repo: "alice/hf-chat-traces" });

		const [, card] = vi.mocked(hub.commit).mock.calls[0][0].operations;
		expect(card).toMatchObject({ operation: "addOrUpdate", path: "README.md" });
		expect(await (card as { content: Blob }).content.text()).toContain("viewer_mode: traces");
	});

	it("keeps the same path after the conversation is renamed", async () => {
		const { locals } = await signedIn();
		const conv = await createTestConversation(locals, { mlAssistant: true, title: "New chat" });
		await push(locals, conv._id.toString(), { repo: "alice/t" });
		await collections.conversations.updateOne({ _id: conv._id }, { $set: { title: "Renamed" } });
		await push(locals, conv._id.toString(), { repo: "alice/t" });

		const paths = vi.mocked(hub.commit).mock.calls.map(([call]) => call.operations[0].path);
		expect(paths).toEqual([
			`${conv._id.toString().slice(-8)}.jsonl`,
			`${conv._id.toString().slice(-8)}.jsonl`,
		]);
	});

	it("asks before pushing to a public dataset", async () => {
		const { locals } = await signedIn();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		vi.mocked(hub.datasetInfo).mockResolvedValue({ private: false } as never);

		const refused = await push(locals, conv._id.toString(), { repo: "alice/open" });
		expect(refused.status).toBe(409);
		expect(await refused.json()).toMatchObject({ code: "public-dataset" });
		expect(hub.commit).not.toHaveBeenCalled();

		const res = await push(locals, conv._id.toString(), { repo: "alice/open", allowPublic: true });
		expect(await res.json()).toMatchObject({ private: false, created: false });
		expect(hub.commit).toHaveBeenCalledTimes(1);
	});

	it("creates a missing dataset private before pushing", async () => {
		const { locals } = await signedIn();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		vi.mocked(hub.datasetInfo).mockRejectedValue(hubError(404));

		const res = await push(locals, conv._id.toString(), { repo: "alice/new" });

		expect(await res.json()).toMatchObject({ created: true, private: true });
		expect(hub.createRepo).toHaveBeenCalledWith({
			repo: { type: "dataset", name: "alice/new" },
			accessToken: "hf_user",
			private: true,
		});
		expect(hub.commit).toHaveBeenCalledTimes(1);
	});

	it("reports a token that cannot write as 403", async () => {
		const { locals } = await signedIn();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		vi.mocked(hub.commit).mockRejectedValueOnce(hubError(403));

		const res = await push(locals, conv._id.toString(), { repo: "org/locked" });
		expect(res.status).toBe(403);
		expect((await res.json()).message).toContain("only write to datasets it created");
	});

	it("tells a sign-in that cannot create datasets to sign in again", async () => {
		const { locals } = await signedIn();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		vi.mocked(hub.datasetInfo).mockRejectedValue(hubError(404));
		vi.mocked(hub.createRepo).mockRejectedValueOnce(hubError(403));

		const res = await push(locals, conv._id.toString(), { repo: "alice/new" });
		expect(res.status).toBe(403);
		const { message } = await res.json();
		expect(message).toContain("Sign out and back in");
		expect(message).not.toContain("try a new dataset name");
	});

	it("reports an inaccessible private repo the Hub 404s then 409s as 403", async () => {
		const { locals } = await signedIn();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		vi.mocked(hub.datasetInfo).mockRejectedValue(hubError(404));
		vi.mocked(hub.createRepo).mockRejectedValueOnce(hubError(409));

		const res = await push(locals, conv._id.toString(), { repo: "bob/private" });
		expect(res.status).toBe(403);
		expect((await res.json()).message).toContain("try a new dataset name");
		expect(hub.commit).not.toHaveBeenCalled();
	});

	it("keeps a network error's details off the client", async () => {
		const { locals } = await signedIn();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		vi.mocked(hub.commit).mockRejectedValueOnce(
			new TypeError("fetch failed: connect ECONNREFUSED 10.0.0.12:443")
		);

		const res = await push(locals, conv._id.toString(), { repo: "alice/t" });
		expect(res.status).toBe(502);
		expect(JSON.stringify(await res.json())).not.toContain("10.0.0.12");
	});
});
