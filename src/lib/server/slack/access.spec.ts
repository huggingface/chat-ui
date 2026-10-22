import { beforeEach, expect, it, vi } from "vitest";
import { WebClient } from "@slack/web-api";
import { eligibleParticipant } from "./access";
import type { SlackConfig } from "./config";
const settings: SlackConfig = {
	teamId: "TLOCAL",
	accountMode: "user",
	botToken: "xoxb-test",
	appToken: "xapp-test",
	hfToken: "",
	budgetUsd: 0,
	allowedChannels: [],
};
let client: WebClient;
beforeEach(() => {
	client = new WebClient();
	vi.spyOn(client.users, "info").mockResolvedValue({
		ok: true,
		user: { id: "UEXT", team_id: "TREMOTE" },
	});
	vi.spyOn(client.conversations, "info").mockResolvedValue({
		ok: true,
		channel: { is_ext_shared: true },
	});
	vi.spyOn(client.conversations, "members").mockResolvedValue({ ok: true, members: ["UEXT"] });
});
it("accepts an external personal-account participant on a later member page", async () => {
	vi.mocked(client.conversations.members).mockResolvedValueOnce({
		ok: true,
		members: ["UOTHER"],
		response_metadata: { next_cursor: "next" },
	});
	expect((await eligibleParticipant(client, settings, "UEXT", "CSHARED"))?.team_id).toBe("TREMOTE");
	expect(client.conversations.members).toHaveBeenLastCalledWith({
		channel: "CSHARED",
		limit: 1000,
		cursor: "next",
	});
});
it.each([
	{ is_bot: true },
	{ deleted: true },
	{ is_restricted: true },
	{ is_ultra_restricted: true },
	{ is_stranger: true },
	{ team_id: undefined },
])("rejects ineligible external users %j", async (flags) => {
	vi.mocked(client.users.info).mockResolvedValue({
		ok: true,
		user: { id: "UEXT", team_id: "TREMOTE", ...flags },
	});
	expect(await eligibleParticipant(client, settings, "UEXT", "CSHARED")).toBeUndefined();
});
it("rejects strangers who are not channel members", async () => {
	vi.mocked(client.conversations.members).mockResolvedValue({ ok: true, members: ["UOTHER"] });
	expect(await eligibleParticipant(client, settings, "UEXT", "CSHARED")).toBeUndefined();
});
it("does not allow shared credentials or an excluded channel", async () => {
	expect(
		await eligibleParticipant(client, { ...settings, accountMode: "shared" }, "UEXT", "CSHARED")
	).toBeUndefined();
	expect(
		await eligibleParticipant(
			client,
			{ ...settings, allowedChannels: ["COTHER"] },
			"UEXT",
			"CSHARED"
		)
	).toBeUndefined();
});
it("does not admit external users through internal channels or DMs", async () => {
	expect(await eligibleParticipant(client, settings, "UEXT", "D123")).toBeUndefined();
	vi.mocked(client.conversations.info).mockResolvedValue({
		ok: true,
		channel: { is_ext_shared: false },
	});
	expect(await eligibleParticipant(client, settings, "UEXT", "C123")).toBeUndefined();
});
it("fails closed when Slack membership cannot be checked", async () => {
	vi.mocked(client.conversations.members).mockRejectedValue(Error("Slack unavailable"));
	await expect(eligibleParticipant(client, settings, "UEXT", "CSHARED")).rejects.toThrow(
		"Slack unavailable"
	);
});
