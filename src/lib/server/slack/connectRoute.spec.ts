import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { collections, ready } from "$lib/server/database";
import { createTestUser, cleanupTestData } from "$lib/server/api/__tests__/testHelpers";
import { actions, load } from "../../../routes/slack/connect/+page.server";
beforeEach(async () => {
	await ready;
});
afterEach(async () => {
	await cleanupTestData();
});
it("rejects cross-origin account mutations before processing any link or disconnect", async () => {
	const { locals } = await createTestUser();
	const action = actions.default;
	if (!action) throw new Error("Missing action");
	await expect(
		action({
			locals,
			url: new URL("https://huggingface.co/chat/slack/connect"),
			request: new Request("https://huggingface.co/chat/slack/connect", {
				method: "POST",
				headers: { origin: "https://untrusted.example" },
			}),
		} as Parameters<typeof action>[0])
	).rejects.toMatchObject({ status: 403 });
});
it("disconnects only the signed-in HF account's Slack connections", async () => {
	const a = await createTestUser();
	const b = await createTestUser();
	await collections.slackConnections.insertMany([
		{
			_id: "T123:U123",
			teamId: "T123",
			slackUserId: "U123",
			userId: a.user._id,
			sessionId: a.session.sessionId,
			updatedAt: new Date(),
		},
		{
			_id: "T123:U456",
			teamId: "T123",
			slackUserId: "U456",
			userId: b.user._id,
			sessionId: b.session.sessionId,
			updatedAt: new Date(),
		},
	]);
	const form = new FormData();
	form.set("action", "disconnect");
	const action = actions.default;
	if (!action) throw new Error("Missing action");
	await action({
		locals: a.locals,
		url: new URL("https://huggingface.co/chat/slack/connect"),
		request: new Request("https://huggingface.co/chat/slack/connect", {
			method: "POST",
			headers: { origin: "https://huggingface.co" },
			body: form,
		}),
	} as Parameters<typeof action>[0]);
	expect(await collections.slackConnections.findOne({ _id: "T123:U123" })).toBeNull();
	expect(await collections.slackConnections.findOne({ _id: "T123:U456" })).not.toBeNull();
});

it("preserves same-origin form submissions while hiding link tickets from other sites", async () => {
	const { locals } = await createTestUser();
	const setHeaders = vi.fn();
	await load({
		locals,
		url: new URL("https://chat.example/slack/connect"),
		setHeaders,
	} as unknown as Parameters<typeof load>[0]);
	expect(setHeaders).toHaveBeenCalledWith({
		"cache-control": "private, no-store",
		"referrer-policy": "same-origin",
	});
});
