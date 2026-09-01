import { describe, expect, it } from "vitest";
import { extractTrackioDashboards, TRACKIO_FRAME_SANDBOX } from "$lib/utils/trackio";

describe("trackio dashboard iframe grants", () => {
	// The attribute string is a security contract: a Trackio Space is framed
	// inside trusted chrome, so lock the load-bearing tokens at the source the way
	// PREVIEW_SANDBOX is locked, and make a rewording that widens them fail here.
	it("grants only what the dashboard needs and keeps the escape hatches shut", () => {
		// Needed: a real cross-origin app that reaches its own backend, and an
		// export flow that builds a blob and clicks a download link.
		expect(TRACKIO_FRAME_SANDBOX).toContain("allow-scripts");
		expect(TRACKIO_FRAME_SANDBOX).toContain("allow-same-origin");
		expect(TRACKIO_FRAME_SANDBOX).toContain("allow-downloads");
		// Denied: the pane can auto-open with zero clicks, so an embedded page must
		// not be able to navigate the tab away, spawn windows, or block it a modal.
		expect(TRACKIO_FRAME_SANDBOX).not.toContain("allow-top-navigation");
		expect(TRACKIO_FRAME_SANDBOX).not.toContain("allow-popups");
		expect(TRACKIO_FRAME_SANDBOX).not.toContain("allow-modals");
	});
});

describe("trackio dashboard extraction", () => {
	// Verbatim from the hf_sandbox_fs read of a training log, ANSI colour codes
	// and all — the shape this actually arrives in.
	const REAL_LOG = [
		"* Trackio project initialized: mnist-smoke-test",
		"* Trackio metrics will be synced to Hugging Face Bucket: https://huggingface.co/buckets/abidlabs/trackio-mnist-smoke-bucket",
		`* Creating new space:  [1m[38;5;208mhttps://huggingface.co/spaces/abidlabs/trackio-mnist-smoke[0m`,
		"* Created new run: abidlabs-1788226247",
	].join("\n");

	it("converts a Hub Space page to its embed origin", () => {
		expect(extractTrackioDashboards(REAL_LOG)).toEqual([
			{
				url: "https://abidlabs-trackio-mnist-smoke.hf.space",
				label: "abidlabs/trackio-mnist-smoke",
			},
		]);
	});

	it("normalizes the direct form to the same URL, so one dashboard is one entry", () => {
		// A bare origin and a Hub page for the same Space must dedupe, or the pane
		// nav would show the same run twice and auto-open would fire twice.
		expect(
			extractTrackioDashboards("Trackio dashboard: https://abidlabs-trackio-mnist-smoke.hf.space.")
		).toEqual([
			{
				url: "https://abidlabs-trackio-mnist-smoke.hf.space",
				label: "abidlabs-trackio-mnist-smoke",
			},
		]);
	});

	it("ignores Spaces the run printed for other reasons", () => {
		// The marker has to share the URL's own line: a demo Space deployed by the
		// same job is not a dashboard just because the log mentions Trackio.
		expect(
			extractTrackioDashboards(
				[
					"Trackio syncing to abidlabs/trackio",
					"Demo deployed: https://huggingface.co/spaces/abidlabs/my-demo",
				].join("\n")
			)
		).toEqual([]);
	});

	it("never yields a host outside hf.space, userinfo lookalike included", () => {
		// `https://x.hf.space@evil.com` reads as an hf.space URL and is not one: the
		// real host is evil.com. The match deliberately ends at `.hf.space`, so what
		// comes back is the genuine Space origin and the attacker's host is simply
		// not part of it. This is the property the iframe's grants rest on.
		const found = extractTrackioDashboards(
			"trackio: https://abidlabs-trackio.hf.space@evil.com/dash"
		);
		for (const dashboard of found) {
			expect(new URL(dashboard.url).hostname.endsWith(".hf.space")).toBe(true);
		}
		expect(found.map((d) => d.url)).toEqual(["https://abidlabs-trackio.hf.space"]);
	});
});
