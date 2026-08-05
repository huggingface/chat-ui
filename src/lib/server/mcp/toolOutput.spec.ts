import { describe, it, expect } from "vitest";
import { buildModelToolOutput } from "./toolOutput";

const textBlock = (text: string) => ({ type: "text", text });

describe("buildModelToolOutput", () => {
	it("passes plain text through unchanged", () => {
		expect(buildModelToolOutput({ text: "all good", content: [textBlock("all good")] })).toBe(
			"all good"
		);
	});

	it("returns nothing for a tool that produced nothing", () => {
		expect(buildModelToolOutput({ text: "" })).toBe("");
	});

	it("appends structured output the text does not already carry", () => {
		const out = buildModelToolOutput({
			text: "Job submitted.",
			structured: { id: "job_1", status: "RUNNING" },
		});

		expect(out).toBe('Job submitted.\n{"id":"job_1","status":"RUNNING"}');
	});

	it("uses structured output when there is no text at all", () => {
		expect(buildModelToolOutput({ text: "", structured: { count: 2 } })).toBe('{"count":2}');
	});

	it("does not repeat structured output the text already carries", () => {
		const structured = { id: "job_1", status: "RUNNING" };

		expect(buildModelToolOutput({ text: JSON.stringify(structured), structured })).toBe(
			'{"id":"job_1","status":"RUNNING"}'
		);
	});

	it("detects the duplicate even when the text serialised its keys in another order", () => {
		const out = buildModelToolOutput({
			text: '{"status":"RUNNING","id":"job_1"}',
			structured: { id: "job_1", status: "RUNNING" },
		});

		expect(out).toBe('{"status":"RUNNING","id":"job_1"}');
	});

	it("keeps structured output when the text is prose that merely mentions it", () => {
		const out = buildModelToolOutput({
			text: "The job is RUNNING.",
			structured: { status: "RUNNING" },
		});

		expect(out).toBe('The job is RUNNING.\n{"status":"RUNNING"}');
	});

	// Without this the model reports back that nothing happened.
	it("notes an image the model cannot otherwise see", () => {
		const out = buildModelToolOutput({
			text: "",
			content: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }],
		});

		expect(out).toBe("[image: image/png]");
	});

	it("notes audio and resource links", () => {
		const out = buildModelToolOutput({
			text: "",
			content: [
				{ type: "audio", mimeType: "audio/wav", data: "UklGRg==" },
				{
					type: "resource_link",
					uri: "hf://datasets/acme/x",
					name: "acme/x",
					mimeType: "text/csv",
				},
			],
		});

		expect(out).toBe("[audio: audio/wav]\n[resource: acme/x (text/csv)]");
	});

	it("includes an embedded resource's text rather than describing it", () => {
		const out = buildModelToolOutput({
			text: "Here is the file:",
			content: [
				{
					type: "resource",
					resource: { uri: "file:///train.py", mimeType: "text/x-python", text: "import torch" },
				},
			],
		});

		expect(out).toBe("Here is the file:\nimport torch");
	});

	it("describes a binary embedded resource it cannot inline", () => {
		const out = buildModelToolOutput({
			text: "",
			content: [
				{
					type: "resource",
					resource: {
						uri: "file:///model.bin",
						mimeType: "application/octet-stream",
						blob: "AAA=",
					},
				},
			],
		});

		expect(out).toBe("[resource: file:///model.bin (application/octet-stream)]");
	});

	it("ignores block shapes it does not recognise", () => {
		const out = buildModelToolOutput({
			text: "done",
			content: [{ type: "something_new", payload: 1 }, "not-a-block", null],
		});

		expect(out).toBe("done");
	});

	it("orders text, then blocks, then structured output", () => {
		const out = buildModelToolOutput({
			text: "summary",
			structured: { ok: true },
			content: [textBlock("summary"), { type: "image", mimeType: "image/jpeg" }],
		});

		expect(out).toBe('summary\n[image: image/jpeg]\n{"ok":true}');
	});
});
