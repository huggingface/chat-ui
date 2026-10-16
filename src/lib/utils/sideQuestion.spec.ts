import { describe, expect, it } from "vitest";
import {
	isSlackSideQuestion,
	isWebSideQuestion,
	slackSideQuestion,
	webSideQuestion,
} from "./sideQuestion";

describe("webSideQuestion", () => {
	it("reads only a leading /btw", () => {
		expect(webSideQuestion("/btw what is the loss?")).toBe("what is the loss?");
		expect(webSideQuestion("  /BTW\n multi\nline ")).toBe("multi\nline");
		expect(webSideQuestion("/btw")).toBeUndefined();
		expect(isWebSideQuestion("/btw")).toBe(true);
		expect(isWebSideQuestion("/btwhat")).toBe(false);
		expect(isWebSideQuestion("tell me /btw x")).toBe(false);
	});
});

describe("slackSideQuestion", () => {
	it("accepts btw, btw: and /btw after mentions, in any case", () => {
		expect(slackSideQuestion("btw which job?")).toBe("which job?");
		expect(slackSideQuestion("<@U123> BTW: which job?")).toBe("which job?");
		expect(slackSideQuestion("<@U123|intern> /btw which job?")).toBe("which job?");
		expect(slackSideQuestion("btw")).toBe("");
		expect(isSlackSideQuestion("<@U123> btw")).toBe(true);
	});

	it("leaves ordinary requests alone", () => {
		expect(slackSideQuestion("btwx")).toBeUndefined();
		expect(slackSideQuestion("train it, btw use fp16")).toBeUndefined();
		expect(isSlackSideQuestion(undefined)).toBe(false);
	});
});
