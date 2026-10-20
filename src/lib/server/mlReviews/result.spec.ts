import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { MlReview } from "$lib/types/MlReview";
import { anchorText, clockText, responseLines } from "./result";

describe("anchorText", () => {
	it("prints times as m:ss under an hour and h:mm:ss past it", () => {
		expect(clockText(12.9)).toBe("0:12");
		expect(clockText(754)).toBe("12:34");
		expect(clockText(3_725)).toBe("1:02:05");
	});

	it("prints each anchor the way the pane shows it", () => {
		expect(anchorText({ area: { x: 0.3123, y: 0.06, w: 0.49, h: 0.1249 } })).toBe(
			" [area 31%,6% 49%x12%]"
		);
		expect(anchorText({ time: { start: 12, end: 18 } })).toBe(" [0:12-0:18]");
		expect(anchorText({ time: { start: 12 } })).toBe(" [0:12]");
		expect(anchorText({ time: { start: 12 }, area: { x: 0.31, y: 0.06, w: 0.49, h: 0.12 } })).toBe(
			" [0:12 area 31%,6% 49%x12%]"
		);
		expect(anchorText({ quote: { exact: "the trace ends at", prefix: "", suffix: "" } })).toBe(
			' "the trace ends at"'
		);
		expect(anchorText({})).toBe("");
	});
});

describe("responseLines", () => {
	it("keeps area and time on the comments as stored", () => {
		const now = new Date();
		const review = {
			_id: new ObjectId(),
			records: [{ id: "clip-12", values: {} }],
			schemaHash: "abcd1234",
			drafts: {
				"0": {
					status: "answered",
					answers: {},
					comments: [
						{
							id: "c1",
							field: "audio",
							time: { start: 12, end: 18 },
							body: "Speaker overlap",
							createdAt: now,
						},
						{
							id: "c2",
							field: "video",
							time: { start: 3 },
							area: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
							body: "Logo cut off",
							createdAt: now,
						},
					],
					updatedAt: now,
				},
			},
		} as unknown as MlReview;

		expect(JSON.parse(responseLines(review)[0]).comments).toEqual([
			{ field: "audio", time: { start: 12, end: 18 }, body: "Speaker overlap" },
			{
				field: "video",
				area: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
				time: { start: 3 },
				body: "Logo cut off",
			},
		]);
	});
});
