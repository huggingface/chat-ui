import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import {
	createTestUser,
	createTestConversation,
	cleanupTestData,
} from "$lib/server/api/__tests__/testHelpers";
import {
	saveMcpSelection,
	loadMcpSelection,
	setMcpSyncEnabled,
	mcpSyncStatus,
} from "$lib/server/mcp/savedSelection";
import { runSlackTurn } from "./engine";
import { getOrCreateThread } from "./store";
import { rebuildIdentity, savedSlackSelection } from "$lib/server/generation/parkedSweeper";
import { linkedSessionId } from "./ownerIdentity";
import { PUT } from "../../../routes/api/mcp/selection/+server";

const mocks = vi.hoisted(() => ({
	generate: vi.fn(),
	connected: vi.fn(),
	key: "test-owner-mcp-encryption-key",
}));
vi.mock("$lib/server/config", async (original) => {
	const m = await original<typeof import("$lib/server/config")>();
	return {
		...m,
		config: new Proxy(m.config, {
			get(target, key) {
				if (key === "SLACK_ML_ENABLED") return "true";
				if (key === "SLACK_ML_ACCOUNT_MODE") return "user";
				if (key === "MCP_OAUTH_ENCRYPTION_KEY") return mocks.key;
				return Reflect.get(target, key);
			},
		}),
	};
});
vi.mock("$lib/server/generation/conversationRequest", () => ({
	generateConversationResponse: mocks.generate,
}));
vi.mock("./ownerIdentity", async (original) => ({
	...(await original<typeof import("./ownerIdentity")>()),
	connectedLocals: mocks.connected,
}));
const selection = {
	selectedMcpServerNames: ["Private"],
	selectedMcpServers: [
		{
			name: "Private",
			url: "https://example.com/mcp",
			headers: [{ key: "Authorization", value: "Bearer private-secret" }],
			oauthConnectionId: new ObjectId().toHexString(),
		},
	],
};

beforeEach(async () => {
	await ready;
	mocks.key = "test-owner-mcp-encryption-key";
	mocks.generate.mockReset();
	mocks.generate.mockResolvedValue(new Response(""));
});
afterEach(async () => {
	await collections.mcpSelections.deleteMany({});
	await collections.slackConnections.deleteMany({});
	await collections.slackThreads.deleteMany({});
	await cleanupTestData();
});

async function setup(personal = true) {
	const { user, locals } = await createTestUser();
	const thread = await getOrCreateThread(
		"T1",
		"C1",
		crypto.randomUUID(),
		"U1",
		personal ? user._id : undefined
	);
	await createTestConversation(locals, { _id: thread.conversationId });
	return { user, locals, thread };
}
async function optInAndSave(userId: ObjectId, input: unknown) {
	await setMcpSyncEnabled(userId, true);
	expect(await saveMcpSelection(userId, input)).toBe(true);
}
async function connectSlack(userId: ObjectId) {
	await collections.slackConnections.insertOne({
		_id: `T1:${userId.toHexString()}`,
		teamId: "T1",
		slackUserId: "U1",
		userId,
		sessionId: crypto.randomUUID(),
		updatedAt: new Date(),
	});
}
async function sentSelection() {
	const { request } = mocks.generate.mock.calls.at(-1)?.[0] as { request: Request };
	return JSON.parse(String((await request.formData()).get("data")));
}

describe("Slack owner's saved MCP selection", () => {
	it("encrypts headers and isolates stored selections by account", async () => {
		const owner = await createTestUser();
		const other = await createTestUser();
		await optInAndSave(owner.user._id, selection);
		const saved = await collections.mcpSelections.findOne({ _id: owner.user._id });
		expect(saved?.encryptedSelection).toMatch(/^enc.v1:/);
		expect(JSON.stringify(saved)).not.toContain("private-secret");
		expect(await loadMcpSelection(owner.user._id)).toEqual({ status: "ok", selection });
		expect(await loadMcpSelection(other.user._id)).toEqual({ status: "none" });
	});
	it("stores nothing until the user opts in, and deletes the selection on opt-out", async () => {
		const { user } = await createTestUser();
		expect(await saveMcpSelection(user._id, selection)).toBe(false);
		expect(await collections.mcpSelections.countDocuments()).toBe(0);
		await optInAndSave(user._id, selection);
		await setMcpSyncEnabled(user._id, false);
		expect(await loadMcpSelection(user._id)).toEqual({ status: "none" });
		expect(await saveMcpSelection(user._id, selection)).toBe(false);
		expect(await collections.mcpSelections.countDocuments()).toBe(0);
	});
	it("passes the owner's selection and OAuth reference on turns and refreshes it on resume", async () => {
		const { user, locals, thread } = await setup();
		await optInAndSave(user._id, selection);
		await runSlackTurn(thread, user, { text: "Use my tools" }, locals);
		expect(await sentSelection()).toMatchObject(selection);
		await saveMcpSelection(user._id, { selectedMcpServerNames: [], selectedMcpServers: [] });
		await runSlackTurn(thread, user, { resumeElicitationId: "answer" }, locals);
		expect(await sentSelection()).toMatchObject({
			selectedMcpServerNames: [],
			selectedMcpServers: [],
		});
	});
	it("does not inherit another user's selection or apply one to shared-token sessions", async () => {
		const other = await createTestUser();
		await optInAndSave(other.user._id, selection);
		const personal = await setup();
		await runSlackTurn(personal.thread, personal.user, { text: "Hello" }, personal.locals);
		expect(await sentSelection()).not.toHaveProperty("selectedMcpServers");
		const shared = await setup(false);
		await optInAndSave(shared.user._id, selection);
		await runSlackTurn(shared.thread, shared.user, { text: "Hello" }, shared.locals);
		expect(await sentSelection()).not.toHaveProperty("selectedMcpServers");
	});
	it("refuses a mismatched owner and falls back to preset tools for an unreadable selection", async () => {
		const { thread, user, locals } = await setup();
		await expect(
			runSlackTurn({ ...thread, hfUserId: new ObjectId() }, user, { text: "Hello" }, locals)
		).rejects.toThrow("owner");
		expect(mocks.generate).not.toHaveBeenCalled();
		await collections.mcpSelections.insertOne({
			_id: user._id,
			encryptedSelection: "enc.v1:broken",
			updatedAt: new Date(),
		});
		const note = vi.fn().mockResolvedValue(undefined);
		await runSlackTurn(thread, user, { text: "Hello" }, locals, note);
		expect(note).toHaveBeenCalledOnce();
		expect(await sentSelection()).not.toHaveProperty("selectedMcpServers");
	});
	it("loads the owner's selection only for turns a personal session starts", async () => {
		const { user, locals, thread } = await setup();
		mocks.connected.mockResolvedValue({ ...locals });
		await optInAndSave(user._id, selection);
		const park = { userId: user._id, sessionId: linkedSessionId(thread) };
		const restored = await rebuildIdentity(park);
		expect(restored.locals).not.toHaveProperty("mcp");
		expect(await savedSlackSelection(park, restored.locals, false)).toEqual(selection);
		// an expired token or a web session never picks up the Slack selection
		expect(await savedSlackSelection(park, restored.locals, true)).toBeUndefined();
		expect(await savedSlackSelection({ sessionId: "web" }, restored.locals, false)).toBeUndefined();
		await expect(
			rebuildIdentity({ userId: new ObjectId(), sessionId: linkedSessionId(thread) })
		).rejects.toThrow("owner");
	});
	it("rebuilds identity for non-turn callers even when the selection is unreadable", async () => {
		const { user, locals, thread } = await setup();
		mocks.connected.mockResolvedValue({ ...locals });
		await collections.mcpSelections.insertOne({
			_id: user._id,
			encryptedSelection: "enc.v1:broken",
			updatedAt: new Date(),
		});
		const park = { userId: user._id, sessionId: linkedSessionId(thread) };
		const restored = await rebuildIdentity(park);
		expect(restored.locals.user?._id).toEqual(user._id);
		expect(await savedSlackSelection(park, restored.locals, false)).toBeUndefined();
	});
	it("refuses plaintext persistence without an encryption key", async () => {
		mocks.key = "";
		const userId = new ObjectId();
		await setMcpSyncEnabled(userId, true);
		await expect(saveMcpSelection(userId, selection)).rejects.toThrow("ENCRYPTION_KEY");
		expect(await loadMcpSelection(userId)).toEqual({ status: "none" });
	});
	it("requires same-origin authenticated writes for the current account", async () => {
		const { user, locals } = await createTestUser();
		const send = (origin: string, userId: string, auth = locals) =>
			PUT({
				locals: auth,
				url: new URL("https://chat.test/api/mcp/selection"),
				request: new Request("https://chat.test/api/mcp/selection", {
					method: "PUT",
					headers: { origin, "Content-Type": "application/json" },
					body: JSON.stringify({ ...selection, userId }),
				}),
			} as Parameters<typeof PUT>[0]);
		await expect(send("https://evil.test", user._id.toHexString())).rejects.toMatchObject({
			status: 403,
		});
		await expect(send("https://chat.test", new ObjectId().toHexString())).rejects.toMatchObject({
			status: 409,
		});
		await expect(
			send("https://chat.test", user._id.toHexString(), { ...locals, user: undefined })
		).rejects.toMatchObject({ status: 401 });
		// signed in, but not connected to Slack or not opted in: nothing leaves the browser
		expect((await send("https://chat.test", user._id.toHexString())).status).toBe(204);
		await setMcpSyncEnabled(user._id, true);
		expect((await send("https://chat.test", user._id.toHexString())).status).toBe(204);
		expect(await loadMcpSelection(user._id)).toEqual({ status: "none" });
		await connectSlack(user._id);
		expect(await mcpSyncStatus(user._id)).toEqual({ saved: false });
		expect((await send("https://chat.test", user._id.toHexString())).status).toBe(204);
		expect(await loadMcpSelection(user._id)).toEqual({ status: "ok", selection });
		expect(await mcpSyncStatus(user._id)).toEqual({ saved: true });
	});
});
