import { afterEach, describe, expect, it, vi } from "vitest";
import { createReadTrackioTool, downsample } from "./readTrackioTool";
import type { BuiltinToolContext } from "./types";
import type { Message } from "$lib/types/Message";

const DASH = "https://me-mnist-trackio.hf.space";
const ctx = {} as BuiltinToolContext;

const messages = [
	{
		id: "a1",
		from: "assistant",
		updates: [
			{
				type: "tool",
				subtype: "result",
				uuid: "u",
				result: {
					status: "success",
					call: { name: "create_trackio", parameters: {} },
					outputs: [
						{ text: "Trackio dashboard reserved: https://huggingface.co/spaces/me/mnist-trackio" },
					],
					display: true,
				},
			},
		],
	},
] as unknown as Message[];

function mockSpace(rows: Array<{ step: number; value: number }>) {
	const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: rows })));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("read_trackio", () => {
	it("reads the conversation's dashboard for the range, with the user's token", async () => {
		const fetchMock = mockSpace(
			Array.from({ length: 11 }, (_, i) => ({ step: 995 + i * 50, value: i === 5 ? 9 : 1 }))
		);
		const tool = createReadTrackioTool(
			() => messages,
			() => "hf_user"
		);

		const result = await tool.execute(
			{ project: "mnist", runs: ["baseline"], metrics: ["train/loss"], x_min: 1000, x_max: 1400 },
			ctx
		);

		if (!("resultText" in result)) throw new Error(JSON.stringify(result));
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(`${DASH}/api/get_metric_values`);
		expect(JSON.parse(init.body as string)).toEqual({
			project: "mnist",
			run: "baseline",
			metric_name: "train/loss",
			around_step: 1200,
			window: 201,
		});
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer hf_user");

		const [series] = JSON.parse(result.resultText.split("\n")[1]);
		expect(series).toMatchObject({
			run: "baseline",
			points: 8,
			first: { step: 1045 },
			last: { step: 1395 },
			max: { step: 1245, value: 9 },
		});
	});

	it("refuses a dashboard the conversation never produced", async () => {
		const fetchMock = mockSpace([]);
		const tool = createReadTrackioTool(
			() => messages,
			() => undefined
		);
		const result = await tool.execute(
			{ project: "p", runs: ["r"], metrics: ["m"], dashboard: "https://evil.hf.space" },
			ctx
		);
		expect(result).toHaveProperty("error");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("keeps both ends when downsampling", () => {
		expect(downsample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([1, 4, 7, 10]);
	});
});
