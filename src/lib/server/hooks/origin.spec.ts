import { describe, expect, it } from "vitest";
import { parseRequestOrigin } from "./origin";

describe("parseRequestOrigin", () => {
	it.each([null, "null", "", "not a URL", "file:///tmp/test", "data:text/plain,test"])(
		"does not treat %s as an HTTP origin",
		(origin) => expect(parseRequestOrigin(origin)).toBeUndefined()
	);
	it("preserves valid origins for the existing origin checks", () => {
		expect(parseRequestOrigin("https://example.com")?.host).toBe("example.com");
		expect(parseRequestOrigin("http://localhost:5173")?.hostname).toBe("localhost");
	});
});
