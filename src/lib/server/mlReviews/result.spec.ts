import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { MlReview } from "$lib/types/MlReview";
import {
	REVIEW_RESULT_BUDGET_CHARS,
	anchorText,
	clockText,
	responseLines,
	reviewResultText,
	sourceLine,
} from "./result";

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
			schema: { questions: [] },
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

describe("the source line", () => {
	it("names the path and revision a dataset sample was read through", () => {
		expect(
			sourceLine({
				kind: "dataset",
				repo: "allenai/c4",
				config: "en",
				split: "train",
				revision: "refs/convert/parquet",
				via: "converted",
				partial: true,
				viewerError: "the dataset viewer did not answer in time",
				sample: { method: "random", rows: 50, total: 2_207_027, seed: 3, groups: 5 },
			})
		).toBe(
			"Source: 50 of 2,207,027 rows of allenai/c4 en/train, read from the viewer's Parquet conversion at refs/convert/parquet (it covers only the first part of this split), a random sample grouped inside 5 random row groups, seed 3. The dataset viewer was not used (the dataset viewer did not answer in time), its files were read directly instead, so there is nothing to wait for."
		);
		expect(
			sourceLine({
				kind: "dataset",
				repo: "org/lines",
				config: "default",
				split: "train",
				revision: "main",
				via: "jsonl",
				sample: {
					method: "random",
					rows: 40,
					bytes: 13 * 1024 * 1024,
					seed: 9,
					windows: 20,
					approximate: true,
				},
			})
		).toBe(
			"Source: 40 rows of 13.0 MB of org/lines default/train, read from its JSONL files by range reads at main, an approximate random sample, seed 9, lines picked at random byte offsets (biased toward lines after long ones)."
		);
		expect(sourceLine({ kind: "inline" })).toBeUndefined();
	});
});

describe("reviewResultText size", () => {
	it("keeps comments and inline answers within budget, pointing at the responses file", () => {
		const now = new Date();
		const long = "x".repeat(2_000);
		const review = {
			_id: new ObjectId(),
			schema: {
				title: "Big",
				idField: "id",
				fields: [{ name: "body", type: "text" }],
				questions: Array.from({ length: 20 }, (_, i) => ({
					name: `q${i}`,
					type: "text",
					required: false,
					maxLength: 4_000,
				})),
				suggestions: "shown",
			},
			schemaHash: "abcd1234",
			source: { kind: "inline" },
			records: Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, values: {} })),
			drafts: Object.fromEntries(
				Array.from({ length: 20 }, (_, i) => [
					String(i),
					{
						status: "answered",
						answers: Object.fromEntries(
							Array.from({ length: 20 }, (_, q) => [`q${q}`, "y".repeat(4_000)])
						),
						comments: Array.from({ length: 10 }, (_, c) => ({
							id: `c${c}`,
							body: long,
							createdAt: now,
						})),
						updatedAt: now,
					},
				])
			),
		} as unknown as MlReview;

		const text = reviewResultText(review, {}, [
			{ name: "reviews/big.responses.jsonl", version: 1 },
		]);

		expect(text.length).toBeLessThan(REVIEW_RESULT_BUDGET_CHARS + 10_000);
		expect(text).toContain("Comments (200):");
		expect(text).toMatch(/- \d+ more comments are in the responses file/);
		expect(text).toContain("Answers: too long to repeat here, they are in the responses file");
		expect(text).toContain("All answers: v-file://reviews/big.responses.jsonl (version 1)");
	});
});

describe("reviewResultText unfinished records", () => {
	const reviewOf = (ids: string[], drafts: Record<string, unknown>) =>
		({
			_id: new ObjectId(),
			schema: {
				title: "Golden",
				idField: "id",
				fields: [],
				questions: [
					{
						name: "kind",
						type: "label",
						required: true,
						options: [{ value: "a" }, { value: "b" }],
					},
				],
				suggestions: "after_answer",
			},
			schemaHash: "abcd1234",
			source: { kind: "inline" },
			records: ids.map((id) => ({ id, values: {} })),
			drafts,
		}) as unknown as MlReview;
	const files = [{ name: "reviews/golden.responses.jsonl", version: 1 }];
	const now = new Date();

	it("names the unfinished records and warns they carry no labels", () => {
		const review = reviewOf(["r1", "r2", "r3", "r4"], {
			"0": { status: "answered", answers: { kind: "a" }, comments: [], updatedAt: now },
			"1": { status: "answered", answers: {}, comments: [], updatedAt: now },
			"2": { status: "discarded", answers: {}, comments: [], updatedAt: now },
		});

		const text = reviewResultText(review, {}, files);

		expect(text).toContain("Records: 1 answered, 0 skipped, 1 discarded, 2 not finished (of 4).");
		expect(text).toContain(
			"2 of 4 records not finished: r2, r4\nThose records are missing labels. Do not treat them as labelled, for example in a golden or eval set or a training split."
		);
		expect(responseLines(review).map((line) => JSON.parse(line).status)).toEqual([
			"answered",
			"pending",
			"discarded",
			"pending",
		]);
	});

	it("points at the responses file when the ids outgrow the budget", () => {
		const ids = Array.from({ length: 500 }, (_, i) => `${"x".repeat(100)}-${i}`);

		const text = reviewResultText(reviewOf(ids, {}), {}, files);

		expect(text).toContain(
			'500 of 500 records not finished, their ids are the rows with status "pending" in the responses file'
		);
		expect(text).not.toContain(ids[0]);
		expect(text.length).toBeLessThan(REVIEW_RESULT_BUDGET_CHARS);
	});

	it("says nothing about unfinished records when every record is settled", () => {
		const text = reviewResultText(
			reviewOf(["r1"], {
				"0": { status: "skipped", answers: {}, comments: [], updatedAt: now },
			}),
			{},
			files
		);
		expect(text).not.toContain("not finished:");
		expect(text).not.toContain("missing labels");
	});
});
