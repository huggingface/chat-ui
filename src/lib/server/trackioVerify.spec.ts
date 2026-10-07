import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTrackioSpace } from "./trackioVerify";

const DASH = "https://me-mnist-trackio.hf.space";

function hub(spaceIdFromSettings: string, { host = DASH, isPrivate = false } = {}) {
	const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const authed = JSON.stringify(init?.headers ?? {}).includes("hf_user");
		if (url === `${DASH}/api/get_settings`) {
			return new Response(JSON.stringify({ data: { space_id: spaceIdFromSettings } }));
		}
		if (url.endsWith("/jwt")) {
			return authed
				? new Response(JSON.stringify({ token: "space_jwt" }))
				: new Response("{}", { status: 401 });
		}
		if (url.startsWith("https://huggingface.co/api/spaces/")) {
			if (isPrivate && !authed) return new Response("{}", { status: 404 });
			return new Response(JSON.stringify({ host, tags: ["trackio"], private: isPrivate }));
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
		hub("me/other-trackio", { host: "https://me-other-trackio.hf.space" });
		const check = await verifyTrackioSpace({ url: DASH, label: "x" }, "hf_user");
		expect(check).toMatchObject({ ok: false });
	});

	it("reads a public Space without a login", async () => {
		hub("me/mnist-trackio");
		await expect(verifyTrackioSpace({ url: DASH, label: "x" }, undefined)).resolves.toEqual({
			ok: true,
			spaceId: "me/mnist-trackio",
		});
	});

	it("hands a private Space a Space-scoped JWT, never the token", async () => {
		hub("me/mnist-trackio", { isPrivate: true });
		await expect(verifyTrackioSpace({ url: DASH, label: "x" }, "hf_user")).resolves.toEqual({
			ok: true,
			spaceId: "me/mnist-trackio",
			bearer: "space_jwt",
		});
		await expect(verifyTrackioSpace({ url: DASH, label: "x" }, undefined)).resolves.toMatchObject({
			ok: false,
		});
	});

	it("reports a Hub that cannot be reached instead of throwing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("fetch failed");
			})
		);
		const check = await verifyTrackioSpace(
			{ url: DASH, label: "x", spaceId: "me/mnist-trackio" },
			"hf_user"
		);
		expect(check).toMatchObject({ ok: false });
	});
});
