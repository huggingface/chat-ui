import { describe, expect, it } from "vitest";
import {
	isTrustedAttachmentUrl,
	linkPromptNeedsConfirmation,
	readLinkPromptRequest,
} from "./linkParams";
import { MAX_PARAM_LENGTH } from "./urlParams";

const params = (query: string) => new URLSearchParams(query);
const url = (href: string) => new URL(href);

describe("readLinkPromptRequest", () => {
	it("returns null when the URL carries nothing for the composer", () => {
		expect(readLinkPromptRequest(params(""))).toBeNull();
		expect(readLinkPromptRequest(params("foo=bar"))).toBeNull();
		expect(readLinkPromptRequest(params("q=&prompt=&attachments="))).toBeNull();
		expect(readLinkPromptRequest(params("q=%20%20"))).toBeNull();
	});

	it("reads q as a request to send", () => {
		expect(readLinkPromptRequest(params("q=hello"))).toEqual({
			prompt: "hello",
			attachmentUrls: [],
			send: true,
		});
	});

	it("reads prompt as a prefill", () => {
		expect(readLinkPromptRequest(params("prompt=hello"))).toEqual({
			prompt: "hello",
			attachmentUrls: [],
			send: false,
		});
	});

	it("lets q win over prompt", () => {
		const request = readLinkPromptRequest(params("prompt=draft&q=send"));
		expect(request?.prompt).toBe("send");
		expect(request?.send).toBe(true);
	});

	it("falls back to prompt when q is blank", () => {
		const request = readLinkPromptRequest(params("q=%20&prompt=draft"));
		expect(request?.prompt).toBe("draft");
		expect(request?.send).toBe(false);
	});

	it("ignores an over-long prompt the same way the old handler did", () => {
		const request = readLinkPromptRequest(params(`q=${"a".repeat(MAX_PARAM_LENGTH + 1)}`));
		expect(request).toBeNull();
	});

	it("collects attachments from comma-separated and repeated params", () => {
		const request = readLinkPromptRequest(
			params(
				"attachments=https://a.example/1.md,https://a.example/2.md&attachments=https://b.example/3.md"
			)
		);
		expect(request?.attachmentUrls.map((u) => u.href)).toEqual([
			"https://a.example/1.md",
			"https://a.example/2.md",
			"https://b.example/3.md",
		]);
		expect(request?.prompt).toBeNull();
		expect(request?.send).toBe(false);
	});

	it("drops attachment URLs that could never be fetched, and duplicates", () => {
		const request = readLinkPromptRequest(
			params(
				"attachments=javascript:alert(1),ftp://x/y,https://u:p@a.example/z,not a url,https://a.example/1.md,https://a.example/1.md"
			)
		);
		expect(request?.attachmentUrls.map((u) => u.href)).toEqual(["https://a.example/1.md"]);
	});
});

describe("isTrustedAttachmentUrl", () => {
	it("accepts the sources the Hub and the docs site attach", () => {
		expect(
			isTrustedAttachmentUrl(url("https://huggingface.co/docs/transformers/main/en/index.md"))
		).toBe(true);
		expect(
			isTrustedAttachmentUrl(
				url("https://huggingface.co/buckets/huggingchat/papers-content/resolve/2501.12345.md")
			)
		).toBe(true);
		expect(
			isTrustedAttachmentUrl(
				url("https://huggingface.co/buckets/huggingchat/docs-chat/resolve/reachy-skill.md")
			)
		).toBe(true);
		expect(isTrustedAttachmentUrl(url("https://hf.co/docs/hub/index.md"))).toBe(true);
		expect(isTrustedAttachmentUrl(url("https://HuggingFace.co/docs/hub/index.md"))).toBe(true);
	});

	it("rejects user-uploaded content on the same host", () => {
		expect(
			isTrustedAttachmentUrl(url("https://huggingface.co/datasets/someone/x/resolve/main/evil.txt"))
		).toBe(false);
		expect(
			isTrustedAttachmentUrl(url("https://huggingface.co/someone/x/resolve/main/evil.txt"))
		).toBe(false);
		expect(
			isTrustedAttachmentUrl(
				url("https://huggingface.co/buckets/someone/papers-content/resolve/x.md")
			)
		).toBe(false);
		expect(isTrustedAttachmentUrl(url("https://huggingface.co/docs"))).toBe(false);
		expect(isTrustedAttachmentUrl(url("https://huggingface.co/docsx/evil.md"))).toBe(false);
	});

	it("cannot be escaped with dot segments, encoded or not", () => {
		expect(
			isTrustedAttachmentUrl(url("https://huggingface.co/docs/../someone/x/resolve/main/evil.txt"))
		).toBe(false);
		expect(
			isTrustedAttachmentUrl(
				url("https://huggingface.co/docs/%2e%2e/someone/x/resolve/main/evil.txt")
			)
		).toBe(false);
		expect(
			isTrustedAttachmentUrl(
				url("https://huggingface.co/docs/.%2E/someone/x/resolve/main/evil.txt")
			)
		).toBe(false);
	});

	it("rejects other hosts, schemes, ports and credentials", () => {
		expect(isTrustedAttachmentUrl(url("https://arxiv.org/pdf/2501.12345"))).toBe(false);
		expect(isTrustedAttachmentUrl(url("https://huggingface.co.evil.com/docs/x.md"))).toBe(false);
		expect(isTrustedAttachmentUrl(url("https://evil.com/huggingface.co/docs/x.md"))).toBe(false);
		expect(isTrustedAttachmentUrl(url("http://huggingface.co/docs/x.md"))).toBe(false);
		expect(isTrustedAttachmentUrl(url("https://huggingface.co:8443/docs/x.md"))).toBe(false);
		expect(isTrustedAttachmentUrl(url("https://user@huggingface.co/docs/x.md"))).toBe(false);
	});
});

describe("linkPromptNeedsConfirmation", () => {
	const trusted = "https://huggingface.co/docs/hub/index.md";
	const untrusted = "https://evil.example/payload.txt";

	it("always asks before sending", () => {
		expect(linkPromptNeedsConfirmation({ prompt: "hi", attachmentUrls: [], send: true })).toBe(
			true
		);
		expect(
			linkPromptNeedsConfirmation({ prompt: "hi", attachmentUrls: [url(trusted)], send: true })
		).toBe(true);
	});

	it("lets a prefill with trusted attachments straight through", () => {
		expect(linkPromptNeedsConfirmation({ prompt: "hi", attachmentUrls: [], send: false })).toBe(
			false
		);
		expect(
			linkPromptNeedsConfirmation({ prompt: "hi", attachmentUrls: [url(trusted)], send: false })
		).toBe(false);
		expect(
			linkPromptNeedsConfirmation({ prompt: null, attachmentUrls: [url(trusted)], send: false })
		).toBe(false);
	});

	it("asks when any attachment comes from somewhere we do not publish", () => {
		expect(
			linkPromptNeedsConfirmation({
				prompt: "hi",
				attachmentUrls: [url(trusted), url(untrusted)],
				send: false,
			})
		).toBe(true);
		expect(
			linkPromptNeedsConfirmation({ prompt: null, attachmentUrls: [url(untrusted)], send: false })
		).toBe(true);
	});
});
