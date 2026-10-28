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
	return { ...fixture, ticket, slackUser };
}
it("requires a live owner session, consumes private connection links once, and stores no token copy", async () => {
	const a = await account();
	const b = await account("U456");
	await expect(
		connectAccount(a.ticket, b.user, a.session.sessionId, {
			team: "T123",
			user: b.slackUser,
			expires: Date.now() + 60000,
		})
	).rejects.toThrow("Sign in");
	await connectAccount(a.ticket, a.user, a.session.sessionId, {
		team: "T123",
		user: a.slackUser,
		expires: Date.now() + 60000,
	});
	await expect(
		connectAccount(a.ticket, a.user, a.session.sessionId, {
			team: "T123",
			user: a.slackUser,
			expires: Date.now() + 60000,
		})
	).rejects.toThrow("expired");
	const connection = await collections.slackConnections.findOne({ _id: "T123:U123" });
	expect(connection?.userId).toEqual(a.user._id);
	expect(JSON.stringify(connection)).not.toContain(`hf-${a.user._id}`);
});
it("rejects expired tickets even before Mongo's TTL cleanup", async () => {
	const a = await account();
	await collections.slackLinks.updateMany({}, { $set: { expiresAt: new Date(0) } });
	expect(await readConnectionLink(a.ticket)).toBeNull();
	await expect(
		connectAccount(a.ticket, a.user, a.session.sessionId, {
			team: "T123",
			user: a.slackUser,
			expires: Date.now() + 60000,
		})
	).rejects.toThrow("expired");
});
it("pins the original owner across collaborators and reconstructs the same credentials on resume", async () => {
	const a = await account();
	const b = await account("U456");
	await connectAccount(a.ticket, a.user, a.session.sessionId, {
		team: "T123",
		user: a.slackUser,
		expires: Date.now() + 60000,
	});
	await connectAccount(b.ticket, b.user, b.session.sessionId, {
		team: "T123",
		user: b.slackUser,
		expires: Date.now() + 60000,
	});
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
	await connectAccount(a.ticket, a.user, a.session.sessionId, {
		team: "T123",
		user: a.slackUser,
		expires: Date.now() + 60000,
	});
	const thread = await getOrCreateThread("T123", "C123", "2.0", "U123", a.user._id);
	const b = await account();
	await connectAccount(b.ticket, b.user, b.session.sessionId, {
		team: "T123",
		user: b.slackUser,
		expires: Date.now() + 60000,
	});
	await expect(connectedLocals(thread)).rejects.toThrow("original");
});
it("does not use another browser session after expiry, logout, or disconnect", async () => {
	const a = await account();
	await connectAccount(a.ticket, a.user, a.session.sessionId, {
		team: "T123",
		user: a.slackUser,
		expires: Date.now() + 60000,
	});
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

it("rejects a forwarded ticket when the signed-in Slack identity differs", async () => {
	const attacker = await account("U456");
	const victim = await account("U123");
	await expect(
		connectAccount(attacker.ticket, victim.user, victim.session.sessionId, {
			team: "T123",
			user: "U123",
			expires: Date.now() + 60000,
		})
	).rejects.toThrow("Slack account");
	expect(await collections.slackConnections.findOne({ _id: "T123:U456" })).toBeNull();
	expect(await readConnectionLink(attacker.ticket)).not.toBeNull();
});
it("rejects missing, expired, and cross-workspace Slack identity", async () => {
	const a = await account();
	for (const identity of [
		undefined,
		{ team: "T999", user: "U123", expires: Date.now() + 60000 },
		{ team: "T123", user: "U123", expires: 0 },
	]) {
		await expect(connectAccount(a.ticket, a.user, a.session.sessionId, identity)).rejects.toThrow(
			"Slack account"
		);
	}
});

it("requires old unverified account connections to reconnect", async () => {
	const a = await account();
	await collections.slackConnections.insertOne({
		_id: "T123:U123",
		teamId: "T123",
		slackUserId: "U123",
		userId: a.user._id,
		sessionId: a.session.sessionId,
		updatedAt: new Date(),
	});
	const thread = await getOrCreateThread("T123", "C123", "5.0", "U123", a.user._id);
	await expect(connectedLocals(thread)).rejects.toThrow("reconnect");
});

it("keeps multiple unexpired connection links usable", async () => {
	const a = await account();
	const second = await createConnectionLink("T123", a.slackUser);
	expect(await readConnectionLink(a.ticket)).not.toBeNull();
	expect(await readConnectionLink(new URL(second).searchParams.get("ticket") ?? "")).not.toBeNull();
});
it("extends active owner sessions and exposes expired continuations without credentials", async () => {
	const a = await account();
	await connectAccount(a.ticket, a.user, a.session.sessionId, {
		team: "T123",
		user: a.slackUser,
		expires: Date.now() + 60000,
	});
	const thread = await getOrCreateThread("T123", "C123", "1.0", a.slackUser, a.user._id);
	await collections.sessions.updateOne(
		{ _id: a.session._id },
		{ $set: { expiresAt: new Date(Date.now() + 60000) } }
	);
	await connectedLocals(thread);
	expect(
		(await collections.sessions.findOne({ _id: a.session._id }))?.expiresAt.getTime()
	).toBeGreaterThan(Date.now() + 13 * 86400000);
	await collections.sessions.deleteOne({ _id: a.session._id });
	const resumed = await rebuildIdentity({ userId: a.user._id, sessionId: linkedSessionId(thread) });
	expect(resumed.tokenExpired).toBe(true);
	expect(resumed.locals.token).toBeUndefined();
});
