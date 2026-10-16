import { describe, expect, it } from "vitest";
import { isWebSideQuestion, slackSideQuestion, webSideQuestion } from "./sideQuestion";

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
	it("accepts btw, btw: and /btw after the bot mention, in any case", () => {
		expect(slackSideQuestion("btw which job?", "UBOT")).toBe("which job?");
		expect(slackSideQuestion("<@UBOT> BTW: which job?", "UBOT")).toBe("which job?");
		expect(slackSideQuestion("<@UBOT|intern> /btw which job?", "UBOT")).toBe("which job?");
		expect(slackSideQuestion("<@UBOT> btw", "UBOT")).toBe("");
	});

	it("leaves ordinary requests and mentions of other people alone", () => {
		expect(slackSideQuestion("btwx", "UBOT")).toBeUndefined();
		expect(slackSideQuestion("train it, btw use fp16", "UBOT")).toBeUndefined();
		expect(slackSideQuestion("<@ALICE> btw the dataset moved", "UBOT")).toBeUndefined();
	});
});
