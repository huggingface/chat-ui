import { describe, expect, it } from "vitest";
import { threadPrompt } from "$lib/server/slack/context";
import { splitSlackRequest } from "./slackRequest";

const prompt = (text: string, ts = "101.0") =>
	threadPrompt(
		[{ user: "U2", ts: "100.0", text: "Use the 4x model we discussed" }],
		{ user: "U1", ts, text },
		"UBOT"
	);

describe("splitSlackRequest", () => {
	it("separates the request from the Slack framing that produced it", () => {
		const { request, context } = splitSlackRequest(
			prompt("Hey <@UBOT> can you tell me the best upscaler?")
		);
		expect(request).toBe("Hey can you tell me the best upscaler?");
		expect(context).toContain("The invoking Slack user is U1.");
		expect(context).toContain("Use the 4x model we discussed");
		expect(context).not.toContain("Invoking user's request");
	});

	it("keeps a request that quotes the marker phrase intact", () => {
		const text = "Explain this line:\nInvoking user's request:\nwhat does it mean?";
		expect(splitSlackRequest(prompt(text)).request).toBe(text);
	});

	it("folds every block of queued follow-ups joined into one turn", () => {
		const joined = `${prompt("Use the 7B model")}\n\n${prompt("and push it", "102.0")}`;
		const { request, context } = splitSlackRequest(joined);
		expect(request).toBe("Use the 7B model\n\nand push it");
		expect(context?.match(/The invoking Slack user is/g)).toHaveLength(2);
	});

	it("leaves ordinary messages untouched", () => {
		expect(splitSlackRequest("What is the best upscaler?")).toEqual({
			request: "What is the best upscaler?",
		});
	});
});
