import { describe, expect, it } from "vitest";
import { redact } from "./redact";

const token = `hf_${"a".repeat(34)}`;

describe("redact", () => {
	it("catches a token after an escaped newline", () => {
		expect(redact(JSON.stringify(`line\n${token}`))).toBe(JSON.stringify("line\n[REDACTED]"));
	});

	it("leaves ids and names that only look like keys", () => {
		const text = JSON.stringify("task-0d6236bd-f4f3-4db6-a51c-0a120a633543 hf_hub_download");
		expect(redact(text)).toBe(text);
	});
});
