import { describe, expect, it } from "vitest";
import {
	parseTrackioView,
	trackioViewChipParts,
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
		expect(trackioViewChipParts({ ...view, xRange: null, runs: [view.runs[0]] })).toMatchObject({
			runs: "1 run",
			range: "all steps",
		});
	});

	it("appends a view block the model can act on after the user's text", () => {
		const content = withTrackioViewContext("what happened here?", [view]);
		expect(content.startsWith("what happened here?\n\n<trackio_dashboard_view")).toBe(true);
		expect(content).toContain("range: 1000 to 1500 (the user zoomed to this)");
		expect(content).toContain("charts on screen: train/loss");
		expect(content).toContain("other metrics shown: eval/loss");
		expect(content).toContain("read_trackio");
		expect(withTrackioViewContext("hi", [])).toBe("hi");
	});
});
