import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import { WebClient } from "@slack/web-api";
import { canView, sign, verify, identitySchema } from "./auth";
import type { SlackThread } from "../types";
const secret = "a".repeat(48);
const thread: SlackThread = {
	_id: "T1:C1:1.0",
	teamId: "T1",
	channel: "C1",
	threadTs: "1.0",
	owner: "U1",
	watching: false,
	conversationId: new ObjectId(),
	createdAt: new Date(),
	updatedAt: new Date(),
};
const viewer = { team: "T1", user: "U1", expires: Date.now() + 864000000 };
let clock = Date.now();
beforeEach(() => {
	vi.useFakeTimers();
	clock += 61000;
	vi.setSystemTime(clock);
});
afterEach(() => vi.useRealTimers());
function client() {
	const c = new WebClient("test");
	vi.spyOn(c.users, "info").mockResolvedValue({ ok: true, user: { id: "U1", team_id: "T1" } });
	vi.spyOn(c.conversations, "info").mockResolvedValue({
		ok: true,
		channel: { id: "C1", is_ext_shared: false },
	});
	vi.spyOn(c.conversations, "members").mockResolvedValue({ ok: true, members: ["U1"] });
	return c;
}
describe("Slack viewer access", () => {
	it("rejects forged or wrongly signed browser cookies", () => {
		const data = { ...viewer };
		const cookie = sign(data, secret);
		expect(verify(cookie, secret)).toEqual(data);
		expect(verify(cookie, "b".repeat(48))).toBeUndefined();
		expect(verify(cookie + "x", secret)).toBeUndefined();
		expect(verify("invalid", secret)).toBeUndefined();
	});
	it("requires workspace membership and checks channel membership anew", async () => {
		const c = client();
		expect(await canView(thread, viewer, c)).toBe(true);
		vi.mocked(c.conversations.members).mockResolvedValue({ ok: true, members: [] });
		expect(await canView(thread, viewer, c)).toBe(true);
		expect(c.conversations.members).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(61000);
		expect(await canView(thread, viewer, c)).toBe(false);
		expect(await canView(thread, { ...viewer, team: "T2" }, c)).toBe(false);
	});
	it("rejects guests, deleted members and shared channels", async () => {
		const c = client();
		vi.mocked(c.users.info).mockResolvedValue({
			ok: true,
			user: { team_id: "T1", is_restricted: true },
		});
		expect(await canView(thread, viewer, c)).toBe(false);
		vi.mocked(c.users.info).mockResolvedValue({ ok: true, user: { team_id: "T1", deleted: true } });
		expect(await canView(thread, viewer, c)).toBe(false);
		vi.mocked(c.users.info).mockResolvedValue({ ok: true, user: { team_id: "T1" } });
		vi.mocked(c.conversations.info).mockResolvedValue({
			ok: true,
			channel: { is_ext_shared: true },
		});
		expect(await canView(thread, viewer, c)).toBe(false);
	});
	it("restricts DM sessions to their owner", async () => {
		const c = client();
		expect(await canView({ ...thread, channel: "D1" }, viewer, c)).toBe(true);
		expect(await canView({ ...thread, channel: "D1", owner: "U2" }, viewer, c)).toBe(false);
		expect(c.conversations.members).not.toHaveBeenCalled();
	});
	it("checks every membership page and fails closed on Slack errors", async () => {
		const c = client();
		vi.mocked(c.conversations.members)
			.mockResolvedValueOnce({ ok: true, members: [], response_metadata: { next_cursor: "next" } })
			.mockResolvedValueOnce({ ok: true, members: ["U1"] });
		expect(await canView(thread, viewer, c)).toBe(true);
		expect(c.conversations.members).toHaveBeenLastCalledWith({
			channel: "C1",
			limit: 1000,
			cursor: "next",
		});
		vi.advanceTimersByTime(61000);
		vi.mocked(c.users.info).mockRejectedValue(new Error("Slack unavailable"));
		await expect(canView(thread, viewer, c)).rejects.toThrow();
	});
});

it("does not expose personal HuggingChat conversations through Slack-only viewer auth", async () => {
	expect(await canView({ ...thread, hfUserId: new ObjectId() }, viewer, client())).toBe(false);
});

it("accepts Enterprise Grid user IDs in verified identities", () => {
	expect(identitySchema.safeParse({ ...viewer, user: "W123" }).success).toBe(true);
});
