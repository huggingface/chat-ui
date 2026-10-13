import { expect, it } from "vitest";
import { scrub } from "./data";
it("omits private reasoning, secrets and binary data from the viewer", () => {
	const result = scrub(
		{
			text: "Public<think>private</think> result hf_123456789012345",
			reasoning: "hidden",
			authorization: "Bearer private",
			script: "secret-value xoxb-123-456-abcdef",
			image: "data:image/png;base64,aGVsbG8=",
			nested: { base64: "binary", value: "visible" },
		},
		["secret-value"]
	);
	const text = JSON.stringify(result);
	expect(text).not.toMatch(/private|hidden|secret-value|hf_123|xoxb-|aGVsbG8|binary/);
	expect(text).toContain("visible");
});
