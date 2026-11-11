import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import {
	cleanupTestData,
	createTestConversation,
	createTestUser,
} from "$lib/server/api/__tests__/testHelpers";
import { readConsoleEntries, readFrame } from "$lib/server/spaceConsole/store";

vi.mock("$lib/utils/mlAssistantFlag", () => ({ ML_ASSISTANT_MODE: true }));
vi.mock("$lib/server/apiToken", () => ({
	getUserHubToken: (locals: App.Locals) => locals.token,
}));

const { GET, POST } = await import("../../../routes/conversation/[id]/space-console/+server");

beforeAll(async () => {
	await ready;
	await collections.spaceConsoleEntries.createIndex(
		{ conversationId: 1, spaceId: 1, sessionId: 1, seq: 1 },
		{ unique: true }
	);
	await collections.spaceConsoleFrames.createIndex(
		{ conversationId: 1, spaceId: 1 },
		{ unique: true }
	);
});

const SPACE = "pngwn/demo";

function send(id: string, locals: App.Locals, body: unknown, raw?: string): Promise<Response> {
	return Promise.resolve(
		POST({
			params: { id },
			locals,
			request: new Request(`http://localhost/conversation/${id}/space-console`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: raw ?? JSON.stringify(body),
			}),
		} as never)
	).catch((thrown: { status: number }) => new Response(null, { status: thrown.status }));
}

function sign(id: string, locals: App.Locals, space = SPACE): Promise<Response> {
	return Promise.resolve(
		GET({
			params: { id },
			locals,
			url: new URL(`http://localhost/conversation/${id}/space-console?space=${space}`),
		} as never)
	).catch((thrown: { status: number }) => new Response(null, { status: thrown.status }));
}

const entry = (seq: number, extra: Record<string, unknown> = {}) => ({
	session_id: "s1",
	seq,
	ts: 1_000 + seq,
	level: "error",
	text: `entry ${seq}`,
	...extra,
});

describe.sequential("POST /conversation/[id]/space-console", () => {
	afterEach(async () => {
		vi.unstubAllGlobals();
		await collections.spaceConsoleEntries.deleteMany({});
		await collections.spaceConsoleFrames.deleteMany({});
		await cleanupTestData();
	});

	it("stores the frame's state and its entries for the owner", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		const id = conv._id.toString();

		expect(
			(await send(id, locals, { space: SPACE, load: "l1", check: "c1", state: "loading" })).status
		).toBe(200);
		await send(id, locals, {
			space: SPACE,
			load: "l1",
			state: "connected",
			session_id: "s1",
			gradio_version: "6.31.0",
		});
		const res = await send(id, locals, {
			space: SPACE,
			load: "l1",
			session_id: "s1",
			gradio_version: "6.31.0",
			entries: [entry(1), entry(2, { stack: "TypeError\n at f" })],
			dropped: 7,
			answers: "c1",
		});
		expect(await res.json()).toEqual({ stored: 2, rejected: 0 });

		expect(await readFrame(conv._id, SPACE)).toMatchObject({
			loadId: "l1",
			loadedFor: "c1",
			checkId: "c1",
			answeredCheck: "c1",
			state: "connected",
			sessionId: "s1",
			gradioVersion: "6.31.0",
			dropped: 7,
		});
		const stored = await readConsoleEntries(conv._id, SPACE);
		expect(stored.map((e) => [e.sessionId, e.seq, e.text, e.stack])).toEqual([
			["s1", 1, "entry 1", undefined],
			["s1", 2, "entry 2", "TypeError\n at f"],
		]);
	});

	it("refuses anyone but the owner, and conversations outside ML Intern", async () => {
		const owner = await createTestUser();
		const other = await createTestUser();
		const conv = await createTestConversation(owner.locals, { mlAssistant: true });
		const plain = await createTestConversation(owner.locals);
		const body = { space: SPACE, load: "l1", entries: [entry(1)] };

		expect((await send(conv._id.toString(), other.locals, body)).status).toBe(404);
		expect(
			(await send(conv._id.toString(), { ...other.locals, user: undefined, sessionId: "" }, body))
				.status
		).toBe(401);
		expect((await send(plain._id.toString(), owner.locals, body)).status).toBe(400);
		expect((await send(new ObjectId().toString(), owner.locals, body)).status).toBe(404);
		expect(await collections.spaceConsoleEntries.countDocuments({})).toBe(0);
	});

	it("refuses a bad Space id, a bad state, too many entries and an oversized body", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		const id = conv._id.toString();

		expect((await send(id, locals, { space: "https://evil.example", load: "l" })).status).toBe(400);
		expect((await send(id, locals, { space: SPACE, load: "l", state: "open" })).status).toBe(400);
		expect((await send(id, locals, { space: SPACE })).status).toBe(400);
		const many = Array.from({ length: 101 }, (_, i) => entry(i + 1));
		expect((await send(id, locals, { space: SPACE, load: "l", entries: many })).status).toBe(400);
		const huge = JSON.stringify({ space: SPACE, load: "l", pad: "x".repeat(600 * 1024) });
		expect((await send(id, locals, null, huge)).status).toBe(413);
		expect((await send(id, locals, null, "{not json")).status).toBe(400);
	});

	it("drops bad or oversized entries one by one and clips long text", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		const res = await send(conv._id.toString(), locals, {
			space: SPACE,
			load: "l1",
			entries: [
				entry(1, { text: "x".repeat(5000) }),
				entry(2, { text: "y".repeat(20_000) }),
				entry(0),
				"not an entry",
				entry(3),
			],
		});
		expect(await res.json()).toEqual({ stored: 2, rejected: 3 });
		const stored = await readConsoleEntries(conv._id, SPACE);
		expect(stored.map((e) => e.seq)).toEqual([1, 3]);
		expect(stored[0].text).toHaveLength(4096);
		expect(stored[0].text.endsWith("…[truncated]")).toBe(true);
	});

	it("rate limits per conversation", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		const statuses: number[] = [];
		for (let i = 0; i < 45; i++) {
			statuses.push((await send(conv._id.toString(), locals, { space: SPACE, load: "l" })).status);
		}
		expect(statuses.slice(0, 40).every((s) => s === 200)).toBe(true);
		expect(statuses.slice(40).every((s) => s === 429)).toBe(true);
	});
});

describe.sequential("GET /conversation/[id]/space-console", () => {
	afterEach(async () => {
		vi.unstubAllGlobals();
		await cleanupTestData();
	});

	function hub(space: { private: boolean } | null, jwt: Response | null) {
		const calls: { url: string; auth: string | null }[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init?: RequestInit) => {
				calls.push({ url, auth: new Headers(init?.headers).get("Authorization") });
				if (url.endsWith("/jwt")) return jwt ?? new Response("", { status: 403 });
				if (!space) return new Response("", { status: 401 });
				return Response.json({ sdk: "gradio", host: "https://pngwn-demo.hf.space", ...space });
			})
		);
		return calls;
	}

	it("mints a Space JWT for a private Space with the user's token", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		const calls = hub({ private: true }, Response.json({ token: "jwt-abc" }));
		const res = await sign(conv._id.toString(), { ...locals, token: "hf_user" });
		expect(await res.json()).toEqual({ sign: "jwt-abc" });
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(calls).toEqual([
			{ url: `https://huggingface.co/api/spaces/${SPACE}`, auth: "Bearer hf_user" },
			{ url: `https://huggingface.co/api/spaces/${SPACE}/jwt`, auth: "Bearer hf_user" },
		]);
	});

	it("returns no token for a public Space, or when the Hub refuses", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		const withToken = { ...locals, token: "hf_user" };

		let calls = hub({ private: false }, Response.json({ token: "unused" }));
		expect(await (await sign(conv._id.toString(), withToken)).json()).toEqual({ sign: null });
		expect(calls.some((c) => c.url.endsWith("/jwt"))).toBe(false);

		calls = hub({ private: true }, null);
		expect(await (await sign(conv._id.toString(), withToken)).json()).toEqual({ sign: null });
	});

	it("refuses anyone but the owner and a bad Space id", async () => {
		const owner = await createTestUser();
		const other = await createTestUser();
		const conv = await createTestConversation(owner.locals, { mlAssistant: true });
		hub({ private: true }, Response.json({ token: "jwt-abc" }));
		expect((await sign(conv._id.toString(), { ...other.locals, token: "hf_x" })).status).toBe(404);
		expect((await sign(conv._id.toString(), owner.locals, "../../evil")).status).toBe(400);
	});
});
