import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("$lib/server/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { trackioSpaceId, trackioProvisionScript, fetchTrackioSpaceStatus } =
	await import("./trackioSpace");

describe("trackioSpaceId", () => {
	it("is stable for a project, so a rerun reuses its Space", () => {
		expect(trackioSpaceId("pngwn", "smollm2-capybara")).toBe("pngwn/smollm2-capybara-trackio");
		expect(trackioSpaceId("pngwn", "SmolLM2 Capybara")).toBe("pngwn/smollm2-capybara-trackio");
	});

	it("survives a project name that is all punctuation", () => {
		expect(trackioSpaceId("pngwn", "///")).toBe("pngwn/trackio-trackio");
	});
});

describe("trackioProvisionScript", () => {
	it("provisions through trackio rather than writing the Space files", () => {
		// A hand-built Space with the wrong layout or version answers init and then
		// refuses every write; trackio's own deploy path is what keeps it correct.
		const script = trackioProvisionScript("pngwn/x-trackio", "x");

		expect(script).toContain("import trackio");
		expect(script).toContain('space_id="pngwn/x-trackio"');
		expect(script).toContain("trackio.finish()");
	});

	it("quotes ids rather than interpolating them into Python", () => {
		const script = trackioProvisionScript('pngwn/a"b', 'p"q');

		expect(script).toContain('"pngwn/a\\"b"');
		expect(script).toContain('"p\\"q"');
	});
});

describe("fetchTrackioSpaceStatus", () => {
	beforeEach(() => vi.unstubAllGlobals());

	const respond = (status: number, body: unknown) =>
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body })
		);

	it("is live once the Space is running", async () => {
		respond(200, { runtime: { stage: "RUNNING" } });
		await expect(fetchTrackioSpaceStatus("a/b")).resolves.toBe("live");
	});

	it("is missing before trackio has created it", async () => {
		respond(404, {});
		await expect(fetchTrackioSpaceStatus("a/b")).resolves.toBe("missing");
	});

	it("is building while it builds", async () => {
		respond(200, { runtime: { stage: "BUILDING" } });
		await expect(fetchTrackioSpaceStatus("a/b")).resolves.toBe("building");
	});

	it("is failed where polling again would never help", async () => {
		respond(200, { runtime: { stage: "BUILD_ERROR" } });
		await expect(fetchTrackioSpaceStatus("a/b")).resolves.toBe("failed");
	});

	it("keeps polling when the lookup itself fails", async () => {
		// A lookup that failed is not a Space that failed.
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
		await expect(fetchTrackioSpaceStatus("a/b")).resolves.toBe("building");
	});
});
