import { expect, it, vi, beforeEach } from "vitest";
const findOne = vi.hoisted(() => vi.fn());
const find = vi.hoisted(() => vi.fn());
vi.mock("$lib/server/database", () => ({ collections: { slackThreads: { findOne, find } } }));
import { ObjectId } from "mongodb";
import { isSlackConversationMutation, nonSlackConversationIds } from "./readOnly";
const id = "6ad03a4c353929f19edc560f";
beforeEach(() => {
	findOne.mockReset();
	findOne.mockResolvedValue({ _id: "thread" });
});
it.each([
	["POST", "/conversation/[id]"],
	["POST", "/conversation/[id]/elicitation"],
	["POST", "/conversation/[id]/stop-generating"],
	["POST", "/conversation/[id]/wake"],
	["PATCH", "/api/v2/conversations/[id]"],
	["DELETE", "/api/conversation/[id]"],
	["PUT", "/api/v2/conversations/[id]/files/[...name]"],
])("blocks Slack mutation %s %s", async (method, route) => {
	expect(await isSlackConversationMutation(method, route, id)).toBe(true);
});
it("allows inspection, including streams and trace downloads", async () => {
	expect(await isSlackConversationMutation("GET", "/conversation/[id]/stream", id)).toBe(false);
	expect(findOne).not.toHaveBeenCalled();
});
it("leaves normal conversations editable", async () => {
	findOne.mockResolvedValue(null);
	expect(await isSlackConversationMutation("POST", "/conversation/[id]", id)).toBe(false);
});
it("does not affect unrelated routes", async () => {
	expect(await isSlackConversationMutation("POST", "/models/[id]", id)).toBe(false);
	expect(findOne).not.toHaveBeenCalled();
});

it("preserves Slack sessions during bulk history deletion", async () => {
	const slack = new ObjectId(),
		normal = new ObjectId();
	find.mockReturnValue({ project: () => ({ toArray: async () => [{ conversationId: slack }] }) });
	expect(await nonSlackConversationIds([slack, normal])).toEqual([normal]);
});
