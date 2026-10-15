import { expect, it, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
const mocks = vi.hoisted(() => ({ findOne: vi.fn(), updateMany: vi.fn(), abort: vi.fn() }));
vi.mock("$lib/server/database", () => ({
	collections: {
		conversations: { findOne: mocks.findOne },
		slackThreads: { updateMany: mocks.updateMany },
	},
}));
vi.mock("$lib/server/auth", () => ({ authCondition: () => ({ userId: "owner" }) }));
vi.mock("$lib/server/abortRegistry", () => ({
	AbortRegistry: { getInstance: () => ({ abort: mocks.abort }) },
}));
import { isSlackConversationMutation, retireSlackConversations } from "./readOnly";
const id = "6ad03a4c353929f19edc560f";
const locals = {} as App.Locals;
beforeEach(() => {
	vi.clearAllMocks();
	mocks.findOne.mockResolvedValue({ _id: new ObjectId(id), managedBy: { kind: "slack" } });
});
it.each([
	["POST", "/conversation/[id]"],
	["POST", "/conversation/[id]/elicitation"],
	["POST", "/conversation/[id]/stop-generating"],
	["POST", "/conversation/[id]/wake"],
	["PATCH", "/api/v2/conversations/[id]"],
	["PATCH", "/(app)/conversation/[id]"],
	["PUT", "/api/v2/conversations/[id]/files/[...name]"],
])("blocks owned Slack mutation %s %s", async (method, route) => {
	expect(await isSlackConversationMutation(method, route, id, locals)).toBe(true);
	expect(mocks.findOne.mock.calls[0][0]).toEqual({ _id: new ObjectId(id), userId: "owner" });
});
it("allows inspection without a database lookup", async () => {
	expect(await isSlackConversationMutation("GET", "/conversation/[id]/stream", id, locals)).toBe(
		false
	);
	expect(mocks.findOne).not.toHaveBeenCalled();
});
it("does not reveal unowned conversations or block ordinary conversations", async () => {
	mocks.findOne.mockResolvedValue(null);
	expect(await isSlackConversationMutation("POST", "/conversation/[id]", id, locals)).toBe(false);
	mocks.findOne.mockResolvedValue({ _id: new ObjectId(id) });
	expect(await isSlackConversationMutation("POST", "/conversation/[id]", id, locals)).toBe(false);
});
it("retires an owned Slack thread before allowing deletion", async () => {
	expect(
		await isSlackConversationMutation("DELETE", "/api/v2/conversations/[id]", id, locals)
	).toBe(false);
	expect(mocks.updateMany).toHaveBeenCalledWith(
		{ conversationId: { $in: [new ObjectId(id)] } },
		{ $set: { deletedAt: expect.any(Date), watching: false } }
	);
	expect(mocks.abort).toHaveBeenCalledWith(id);
});
it("allows bulk deletion and retires associated Slack threads", async () => {
	const ids = [new ObjectId(), new ObjectId()];
	expect(await retireSlackConversations(ids)).toEqual(ids);
	expect(mocks.abort).toHaveBeenCalledTimes(2);
});
