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

interface HubFixture {
	tags?: string[];
	host?: string;
	isPrivate?: boolean;
	/** Status the Hub answers the Space lookup with, per call. */
	spaceStatus?: () => number;
}

/** The Hub and the dashboard Space, answering the way each does. */
function mockSpace(rows: Array<{ step: number; value: number }>, hub: HubFixture = {}) {
	const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
		const url = String(input);
		if (url === "https://huggingface.co/api/spaces/me/mnist-trackio/jwt") {
			return new Response(JSON.stringify({ token: "space_jwt" }));
		}
		if (url === "https://huggingface.co/api/spaces/me/mnist-trackio") {
			const status = hub.spaceStatus?.() ?? 200;
			if (status !== 200) return new Response("{}", { status });
			return new Response(
				JSON.stringify({
					id: "me/mnist-trackio",
					host: hub.host ?? DASH,
					tags: hub.tags ?? ["gradio", "trackio"],
					private: hub.isPrivate ?? false,
				})
			);
		}
		return new Response(JSON.stringify({ data: rows }));
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

const authHeader = (init: RequestInit | undefined) =>
	(init?.headers as Record<string, string> | undefined)?.Authorization;

/** Calls that reached the dashboard itself, as opposed to the Hub. */
const dashboardCalls = (fetchMock: ReturnType<typeof mockSpace>) =>
	fetchMock.mock.calls
		.map(([input, init]) => [String(input), init] as [string, RequestInit | undefined])
		.filter(([url]) => url.startsWith(DASH));

afterEach(() => vi.unstubAllGlobals());

describe("read_trackio", () => {
	it("reads a public dashboard for the range, sending no credentials", async () => {
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
		const [[url, init]] = dashboardCalls(fetchMock) as Array<[string, RequestInit]>;
		expect(url).toBe(`${DASH}/api/get_metric_values`);
		expect(JSON.parse(init.body as string)).toEqual({
			project: "mnist",
			run: "baseline",
			metric_name: "train/loss",
			around_step: 1200,
			window: 201,
		});
		expect(authHeader(init)).toBeUndefined();

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

	it("reads a private dashboard with a Space-scoped JWT, minted once per turn", async () => {
		const fetchMock = mockSpace([{ step: 1, value: 1 }], { isPrivate: true });
		const tool = createReadTrackioTool(
			() => messages,
			() => "hf_user"
		);
		await tool.execute({ project: "p", runs: ["r"], metrics: ["m"] }, ctx);
		const result = await tool.execute({ project: "p", runs: ["r"], metrics: ["m"] }, ctx);
		expect(result).toHaveProperty("resultText");

		const calls = dashboardCalls(fetchMock);
		expect(calls).toHaveLength(2);
		for (const [, init] of calls) expect(authHeader(init)).toBe("Bearer space_jwt");
		const mints = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/jwt"));
		expect(mints).toHaveLength(1);
	});

	it("checks again after a failed check, rather than failing the whole turn", async () => {
		const statuses = [503, 200];
		const fetchMock = mockSpace([{ step: 1, value: 1 }], {
			spaceStatus: () => statuses.shift() ?? 200,
		});
		const tool = createReadTrackioTool(
			() => messages,
			() => "hf_user"
		);
		const args = { project: "p", runs: ["r"], metrics: ["m"] };
		expect(await tool.execute(args, ctx)).toHaveProperty("error");
		expect(await tool.execute(args, ctx)).toHaveProperty("resultText");
		expect(dashboardCalls(fetchMock)).toHaveLength(1);
	});

	it.each([
		["is not a Trackio Space", { tags: ["gradio"] }, "not a Trackio Space"],
		["is served somewhere else", { host: "https://elsewhere.hf.space" }, "is not the Space served"],
	])("never reads a Space that %s", async (_label, hub, reason) => {
		const fetchMock = mockSpace([{ step: 1, value: 1 }], hub);
		const tool = createReadTrackioTool(
			() => messages,
			() => "hf_user"
		);
		const result = await tool.execute({ project: "p", runs: ["r"], metrics: ["m"] }, ctx);

		if (!("error" in result)) throw new Error("expected a refusal");
		expect(result.error).toContain(reason);
		expect(dashboardCalls(fetchMock)).toHaveLength(0);
	});

	it("never sends the user's token to the dashboard", async () => {
		const fetchMock = mockSpace([{ step: 1, value: 1 }], { isPrivate: true });
		const tool = createReadTrackioTool(
			() => messages,
			() => "hf_user"
		);
		await tool.execute({ project: "p", runs: ["r"], metrics: ["m"] }, ctx);
		for (const [, init] of dashboardCalls(fetchMock)) {
			expect(JSON.stringify(init ?? {})).not.toContain("hf_user");
		}
	});

	it("keeps both ends when downsampling", () => {
		expect(downsample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([1, 4, 7, 10]);
	});
});
