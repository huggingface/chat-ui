import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { collections, ready } from "$lib/server/database";
import { createTestUser, cleanupTestData } from "$lib/server/api/__tests__/testHelpers";
import {
	connectAccount,
	createConnectionLink,
	readConnectionLink,
	connectedLocals,
	linkedSessionId,
	chatLink,
} from "./connections";
import { getOrCreateThread } from "./store";
import { authCondition } from "$lib/server/auth";
import { rebuildIdentity } from "$lib/server/generation/parkedSweeper";

vi.mock("$lib/server/config", async (original) => {
	const m = await original<typeof import("$lib/server/config")>();
	return {
		...m,
		config: new Proxy(m.config, {
			get(target, key) {
				if (key === "PUBLIC_ORIGIN") return "https://huggingface.co";
				return Reflect.get(target, key);
			},
		}),
	};
});
vi.mock("./config", () => ({ slackConfig: () => ({ teamId: "T123", accountMode: "user" }) }));
beforeEach(async () => {
	await ready;
});
afterEach(async () => {
	await cleanupTestData();
});
async function account(slackUser = "U123") {
	const fixture = await createTestUser();
	await collections.sessions.updateOne(
		{ _id: fixture.session._id },
		{
			$set: {
				oauth: {
					token: { value: `hf-${fixture.user._id}`, expiresAt: new Date(Date.now() + 3600000) },
				},
			},
		}
	);
	const link = await createConnectionLink("T123", slackUser);
	const ticket = new URL(link).searchParams.get("ticket") ?? "";
	return { ...fixture, ticket };
}
it("requires a live owner session, consumes private connection links once, and stores no token copy", async () => {
	const a = await account();
	const b = await account("U456");
	await expect(connectAccount(a.ticket, b.user, a.session.sessionId)).rejects.toThrow("Sign in");
	await connectAccount(a.ticket, a.user, a.session.sessionId);
	await expect(connectAccount(a.ticket, a.user, a.session.sessionId)).rejects.toThrow("expired");
	const connection = await collections.slackConnections.findOne({ _id: "T123:U123" });
	expect(connection?.userId).toEqual(a.user._id);
	expect(JSON.stringify(connection)).not.toContain(`hf-${a.user._id}`);
});
it("rejects expired tickets even before Mongo's TTL cleanup", async () => {
	const a = await account();
	await collections.slackLinks.updateMany({}, { $set: { expiresAt: new Date(0) } });
	expect(await readConnectionLink(a.ticket)).toBeNull();
	await expect(connectAccount(a.ticket, a.user, a.session.sessionId)).rejects.toThrow("expired");
});
it("pins the original owner across collaborators and reconstructs the same credentials on resume", async () => {
	const a = await account();
	const b = await account("U456");
	await connectAccount(a.ticket, a.user, a.session.sessionId);
	await connectAccount(b.ticket, b.user, b.session.sessionId);
	const first = await getOrCreateThread("T123", "C123", "1.0", "U123", a.user._id);
	const second = await getOrCreateThread("T123", "C123", "1.0", "U456", b.user._id);
	expect(second.hfUserId).toEqual(a.user._id);
	const locals = await connectedLocals(second);
	expect(locals.token).toBe(`hf-${a.user._id}`);
	expect(locals.publishNamespace).toBe(a.user.username);
	expect(locals.billingOrganization).toBeUndefined();
	expect(authCondition(locals)).toEqual({ userId: a.user._id });
	const resumed = await rebuildIdentity({ userId: a.user._id, sessionId: linkedSessionId(first) });
	expect(resumed.locals.token).toBe(locals.token);
	await expect(
		rebuildIdentity({ userId: b.user._id, sessionId: linkedSessionId(first) })
	).rejects.toThrow("owner");
	expect(chatLink(first)).toContain(`/conversation/${first.conversationId}`);
});
it("never switches an old thread to a different HF account after reconnecting", async () => {
	const a = await account();
	await connectAccount(a.ticket, a.user, a.session.sessionId);
	const thread = await getOrCreateThread("T123", "C123", "2.0", "U123", a.user._id);
	const b = await account();
	await connectAccount(b.ticket, b.user, b.session.sessionId);
	await expect(connectedLocals(thread)).rejects.toThrow("original");
});
it("does not use another browser session after expiry, logout, or disconnect", async () => {
	const a = await account();
	await connectAccount(a.ticket, a.user, a.session.sessionId);
	const thread = await getOrCreateThread("T123", "C123", "3.0", "U123", a.user._id);
	await collections.sessions.updateOne(
		{ _id: a.session._id },
		{ $set: { expiresAt: new Date(0) } }
	);
	await expect(connectedLocals(thread)).rejects.toThrow("reconnect");
	await collections.sessions.updateOne(
		{ _id: a.session._id },
		{ $set: { expiresAt: new Date(Date.now() + 3600000), "oauth.token.expiresAt": new Date(0) } }
	);
	await expect(connectedLocals(thread)).rejects.toThrow("reconnect");
	await collections.sessions.deleteOne({ _id: a.session._id });
	await expect(connectedLocals(thread)).rejects.toThrow("reconnect");
	await collections.slackConnections.deleteMany({});
	await expect(connectedLocals(thread)).rejects.toThrow("original");
});
