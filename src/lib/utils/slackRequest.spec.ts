import { expect, it } from "vitest";
import { threadPrompt } from "$lib/server/slack/context";
import { splitSlackRequest } from "./slackRequest";

const prompt = (text: string, ts = "101.0") =>
	threadPrompt(
		[{ user: "U2", ts: "100.0", text: "Use the 4x model we discussed" }],
		{ user: "U1", ts, text },
		"UBOT"
	);

it("separates requests, including joined follow-ups, from their Slack framing", () => {
	const { request, context } = splitSlackRequest(
		`${prompt("Hey <@UBOT> can you pick an upscaler?")}\n\n${prompt("and push it", "102.0")}`
	);
	expect(request).toBe("Hey can you pick an upscaler?\n\nand push it");
	expect(context?.match(/The invoking Slack user is U1\./g)).toHaveLength(2);
	expect(context).toContain("Use the 4x model we discussed");
	expect(splitSlackRequest("Plain message").context).toBeUndefined();
});
