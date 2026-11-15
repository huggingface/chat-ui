import { describe, expect, it } from "vitest";
import { acceptTrackioViews } from "./trackioViews";
import type { Message } from "$lib/types/Message";

const DASH = "https://me-mnist-trackio.hf.space";

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

describe("acceptTrackioViews", () => {
	it("keeps views of this conversation's dashboards and drops any other URL", () => {
		const views = acceptTrackioViews(
			[
				{ dashboardUrl: DASH, project: "mnist", runs: [{ name: "r" }] },
				{ dashboardUrl: "https://other-space.hf.space", project: "x" },
				{ project: "no-url" },
			],
			messages
		);
		expect(views.map((v) => v.dashboardUrl)).toEqual([DASH]);
	});
});
