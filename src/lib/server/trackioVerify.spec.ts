import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTrackioSpace } from "./trackioVerify";

const DASH = "https://me-mnist-trackio.hf.space";

function hub(spaceIdFromSettings: string, host = DASH) {
	const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
		const url = String(input);
		if (url === `${DASH}/api/get_settings`) {
			return new Response(JSON.stringify({ data: { space_id: spaceIdFromSettings } }));
		}
		if (url.startsWith("https://huggingface.co/api/spaces/")) {
			return new Response(JSON.stringify({ author: "me", host, tags: ["trackio"] }));
		}
		if (url === "https://huggingface.co/api/whoami-v2") {
			return new Response(JSON.stringify({ name: "me" }));
		}
		return new Response("{}", { status: 404 });
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("verifyTrackioSpace", () => {
	it("takes a bare dashboard's own Space id only once the Hub serves it there", async () => {
		const fetchMock = hub("me/mnist-trackio");
		await expect(verifyTrackioSpace({ url: DASH, label: "x" }, "hf_user")).resolves.toEqual({
			ok: true,
			spaceId: "me/mnist-trackio",
		});
		// The Space was asked its name without the token; only the Hub saw it.
		const settingsCall = fetchMock.mock.calls.find(([u]) => String(u).startsWith(DASH));
		expect(JSON.stringify(settingsCall?.[1] ?? {})).not.toContain("hf_user");
	});

	it("rejects a Space that claims someone else's id", async () => {
		hub("me/other-trackio", "https://me-other-trackio.hf.space");
		const check = await verifyTrackioSpace({ url: DASH, label: "x" }, "hf_user");
		expect(check).toMatchObject({ ok: false });
	});

	it("refuses without a login to check against", async () => {
		hub("me/mnist-trackio");
		await expect(verifyTrackioSpace({ url: DASH, label: "x" }, undefined)).resolves.toMatchObject({
			ok: false,
		});
	});
});
