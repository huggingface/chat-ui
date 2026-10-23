import { afterEach, expect, it, vi } from "vitest";
import { downloadAttachments } from "./attachments";
const file = {
	id: "F1",
	name: "image.png",
	mimetype: "image/png",
	url_private: "https://files.slack.com/files-pri/T-F/image.png",
};
afterEach(() => vi.unstubAllGlobals());
it("downloads invoking and earlier attachments once, excluding later and bot messages", async () => {
	const fetcher = vi.fn().mockImplementation(
		async () =>
			new Response(new Uint8Array([137, 80, 78, 71]), {
				headers: { "content-type": "image/png" },
			})
	);
	vi.stubGlobal("fetch", fetcher);
	const files = await downloadAttachments(
		[
			{ ts: "100.0", user: "U", files: [file] },
			{ ts: "101.0", user: "U", files: [file] },
			{ ts: "102.0", user: "U", files: [{ ...file, id: "later" }] },
			{ ts: "100.1", user: "BOT", files: [{ ...file, id: "bot" }] },
		],
		"101.0",
		"BOT",
		"secret"
	);
	expect(files).toHaveLength(1);
	expect(files[0].name).toBe("image.png");
	expect(files[0].size).toBe(4);
	expect(fetcher).toHaveBeenCalledTimes(1);
	expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer secret");
});
it("never sends credentials to a redirect host and rejects external targets", async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(
			new Response(null, {
				status: 302,
				headers: { location: "https://downloads.slack-edge.com/image.png" },
			})
		)
		.mockResolvedValueOnce(new Response("png"));
	vi.stubGlobal("fetch", fetcher);
	await downloadAttachments([{ ts: "1.0", files: [file] }], "1.0", "BOT", "secret");
	expect(fetcher.mock.calls[1][1].headers).toEqual({});
	fetcher
		.mockReset()
		.mockResolvedValue(
			new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } })
		);
	await expect(
		downloadAttachments([{ ts: "1.0", files: [file] }], "1.0", "BOT", "secret")
	).rejects.toThrow("unsupported");
	expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects oversized files and reports inaccessible attachments instead of ignoring them", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue(new Response("login", { headers: { "content-type": "text/html" } }))
	);
	await expect(
		downloadAttachments(
			[{ ts: "1.0", files: [{ ...file, size: 11 * 1024 * 1024 }] }],
			"1.0",
			"BOT",
			"secret"
		)
	).rejects.toThrow("10 MB");
	await expect(
		downloadAttachments([{ ts: "1.0", files: [file] }], "1.0", "BOT", "secret")
	).rejects.toThrow("files:read");
});

it("keeps owner files and skips poisoned reference files on successive turns", async () => {
	const { downloadThreadAttachments } = await import("./attachments");
	const fetcher = vi.fn(async (url: URL) =>
		url.pathname.includes("bad")
			? new Response("denied", { status: 403 })
			: new Response("owner data")
	);
	vi.stubGlobal("fetch", fetcher);
	const messages = [
		{
			ts: "1",
			user: "OTHER",
			files: [
				{ id: "missing" },
				{ ...file, id: "bad", url_private: "https://files.slack.com/bad" },
				{ ...file, id: "large", size: 11 * 1024 * 1024 },
				...Array.from({ length: 20 }, (_, i) => ({ ...file, id: `ref-${i}` })),
			],
		},
		{ ts: "2", user: "OWNER", files: [file] },
	];
	for (const ts of ["2", "3"]) {
		const result = await downloadThreadAttachments(messages, ts, "BOT", "secret", "OWNER");
		expect(result.referencesOmitted).toBe(true);
		expect(await result.files[0].text()).toBe("owner data");
		expect(result.files.length).toBeLessThanOrEqual(10);
	}
});
it("still reports failures for files the owner explicitly provides", async () => {
	const { downloadThreadAttachments } = await import("./attachments");
	await expect(
		downloadThreadAttachments(
			[{ ts: "1", user: "OWNER", files: [{ id: "missing" }] }],
			"1",
			"BOT",
			"secret",
			"OWNER"
		)
	).rejects.toThrow("download URL");
});
