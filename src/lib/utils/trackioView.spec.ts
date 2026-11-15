import { describe, expect, it } from "vitest";
import {
	findViewTokens,
	parseTrackioView,
	segmentViewText,
	stripOrphanViewMarks,
	trackioViewChipParts,
	trackioViewLabel,
	trackioViewToken,
	viewsInText,
	VIEW_TOKEN_MARK,
	withTrackioViewContext,
	type TrackioDashboardView,
} from "./trackioView";

const DASH = "https://me-mnist-trackio.hf.space";

const RAW = {
	project: "mnist",
	runs: [{ name: "baseline", id: "abc" }, { name: "warmup" }],
	x_axis: "step",
	x_range: [1000, 1500],
	metrics: ["train/loss", "eval/loss"],
	metrics_on_screen: ["train/loss"],
	smoothing: 10,
	latest_x: 2995,
	captured_at: "2026-09-24T00:00:00.000Z",
	view_url: `${DASH}/?xmin=1000&xmax=1500`,
};

describe("parseTrackioView", () => {
	it("shapes the dashboard's snake_case state, and re-parses its own output unchanged", () => {
		const view = parseTrackioView(RAW, DASH);
		expect(view).toMatchObject({
			dashboardUrl: DASH,
			project: "mnist",
			runs: [{ name: "baseline", id: "abc" }, { name: "warmup" }],
			xRange: [1000, 1500],
			metricsOnScreen: ["train/loss"],
			viewUrl: `${DASH}/?xmin=1000&xmax=1500`,
		});
		expect(parseTrackioView(view, DASH)).toEqual(view);
	});

	it("drops what the dashboard has no business sending", () => {
		const view = parseTrackioView(
			{
				...RAW,
				x_range: [5, 1],
				view_url: "https://evil.example/?xmin=1",
				runs: [{ name: "" }, "run", { name: "ok" }],
				metrics: ["a", "a", 3, "b"],
			},
			DASH
		);
		expect(view?.xRange).toBeNull();
		expect(view?.viewUrl).toBeUndefined();
		expect(view?.runs).toEqual([{ name: "ok" }]);
		expect(view?.metrics).toEqual(["a", "b"]);
		expect(parseTrackioView({ runs: [] }, DASH)).toBeNull();
	});
});

describe("chip and model context", () => {
	const view = parseTrackioView(RAW, DASH) as TrackioDashboardView;

	it("labels the chip project, runs, range", () => {
		expect(trackioViewChipParts(view)).toEqual({
			project: "mnist",
			runs: "2 runs",
			range: "steps 1,000–1,500",
		});
		// One run reads as its name, not as a count.
		expect(trackioViewChipParts({ ...view, xRange: null, runs: [view.runs[0]] })).toMatchObject({
			runs: "baseline",
			range: "all steps",
		});
	});

	it("appends a view block the model can act on after the user's text", () => {
		const content = withTrackioViewContext("what happened here?", [view]);
		expect(content.startsWith('what happened here?\n\n<trackio_dashboard_view id="1"')).toBe(true);
		expect(content).toContain("range: 1000 to 1500 (on the step axis; the user zoomed to this)");
		expect(content).toContain("charts on screen: train/loss");
		expect(content).toContain("other metrics shown: eval/loss");
		expect(content).toContain("read_trackio");
		expect(withTrackioViewContext("hi", [])).toBe("hi");
	});
});

describe("inline view tokens", () => {
	const a = parseTrackioView(RAW, DASH) as TrackioDashboardView;
	const b = {
		...a,
		xRange: [3000, 3500] as [number, number],
		capturedAt: "2026-09-24T00:01:00.000Z",
	};
	const text = `why is the loss going up here ${trackioViewToken(a)}, but not here ${trackioViewToken(b)}?`;

	it("reads as its label, with a mark either side", () => {
		expect(trackioViewLabel(a)).toBe("mnist • 2 runs • steps 1,000–1,500");
		// Padded inside the marks, so the chip's padding is real text.
		expect(
			trackioViewToken(a).startsWith(`${VIEW_TOKEN_MARK}${"\u00a0".repeat(4)}\u202fmnist`)
		).toBe(true);
		// Unbreakable inside, so a chip never wraps mid-label.
		expect(trackioViewToken(a)).not.toMatch(/[ -]/);
		expect(findViewTokens(text).map((t) => t.label)).toEqual([
			trackioViewLabel(a),
			trackioViewLabel(b),
		]);
	});

	it("splits a message into words and the views its chips name", () => {
		expect(segmentViewText(text, [b, a]).map((s) => (s.kind === "view" ? s.view : s.text))).toEqual(
			["why is the loss going up here ", a, ", but not here ", b, "?"]
		);
		expect(viewsInText(text, [b, a])).toEqual([a, b]);
	});

	it("tells the model which block each mention means", () => {
		const content = withTrackioViewContext(text, [b, a]);
		expect(
			content.startsWith("why is the loss going up here [view 1], but not here [view 2]?")
		).toBe(true);
		expect(content.indexOf('id="1"')).toBeLessThan(content.indexOf('id="2"'));
		expect(content).toContain("range: 1000 to 1500");
		expect(content).not.toContain(VIEW_TOKEN_MARK);
	});

	it("keeps two views with the same label apart by key", () => {
		const one = { ...a, key: "17" };
		const two = { ...a, metricsOnScreen: ["eval/loss"], key: "52" };
		expect(trackioViewLabel(one)).toBe(trackioViewLabel(two));
		const both = `${trackioViewToken(one)} vs ${trackioViewToken(two)}`;
		expect(findViewTokens(both).map((t) => t.key)).toEqual(["17", "52"]);
		expect(viewsInText(both, [two, one])).toEqual([one, two]);
		expect(withTrackioViewContext(both, [one, two])).toContain("[view 1] vs [view 2]");
	});

	it("gives the model a chip's plain label when no view backs it", () => {
		const content = withTrackioViewContext(`look ${trackioViewToken({ ...a, key: "17" })}`, []);
		expect(content).toBe(`look ${trackioViewLabel(a)}`);
	});

	it("keeps the words of a token cut in half, without its stray mark", () => {
		const cut = text.slice(0, text.indexOf(VIEW_TOKEN_MARK) + 5);
		expect(stripOrphanViewMarks(cut)).not.toContain(VIEW_TOKEN_MARK);
		expect(stripOrphanViewMarks(text)).toBe(text);
	});
});
