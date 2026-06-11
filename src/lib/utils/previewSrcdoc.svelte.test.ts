import { afterEach, describe, expect, it } from "vitest";
import { buildHtmlSrcdoc } from "$lib/utils/previewSrcdoc";

type PreviewMessage = {
	type: string;
	channel: string;
	detail?: { href?: string; message?: string };
};

let iframes: HTMLIFrameElement[] = [];

afterEach(() => {
	for (const iframe of iframes) iframe.remove();
	iframes = [];
});

/** Wait for the next postMessage on the given preview channel */
function nextMessage(channel: string, timeoutMs = 5000): Promise<PreviewMessage> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			window.removeEventListener("message", onMsg);
			reject(new Error("timed out waiting for preview message"));
		}, timeoutMs);
		function onMsg(ev: MessageEvent) {
			const data = ev.data as Partial<PreviewMessage> | null;
			if (!data || typeof data !== "object" || data.channel !== channel) return;
			clearTimeout(timer);
			window.removeEventListener("message", onMsg);
			resolve(data as PreviewMessage);
		}
		window.addEventListener("message", onMsg);
	});
}

/**
 * Render body content in a sandboxed preview iframe, exactly like the artifact
 * panel does. The sandbox has an opaque origin, so tests cannot reach into the
 * document; the body must drive itself (e.g. click its own links on load).
 */
function renderPreview(body: string, channel: string): HTMLIFrameElement {
	const iframe = document.createElement("iframe");
	iframe.sandbox.add("allow-scripts");
	iframe.srcdoc = buildHtmlSrcdoc(
		`<!doctype html><html><head></head><body>${body}</body></html>`,
		channel
	);
	document.body.appendChild(iframe);
	iframes.push(iframe);
	return iframe;
}

describe("preview hook script", () => {
	it("forwards http(s) link clicks to the parent, including clicks on nested elements", async () => {
		const channel = "test_links";
		const message = nextMessage(channel);
		renderPreview(
			`<a href="https://huggingface.co/models"><b id="inner">View model</b></a>
			<script>window.addEventListener('load', function(){ document.getElementById('inner').click(); });</script>`,
			channel
		);
		expect(await message).toEqual({
			type: "chatui.preview.openLink",
			channel,
			detail: { href: "https://huggingface.co/models" },
		});
	});

	it("does not forward javascript: or in-page fragment links", async () => {
		const channel = "test_blocked";
		const message = nextMessage(channel);
		// The js/fragment clicks must produce nothing, so the sentinel link
		// clicked last must be the first message observed
		renderPreview(
			`<a id="js" href="javascript:void(0)">js</a>
			<a id="frag" href="#section">frag</a>
			<div id="section"></div>
			<a id="sentinel" href="http://example.com/after">ok</a>
			<script>window.addEventListener('load', function(){
				document.getElementById('js').click();
				document.getElementById('frag').click();
				document.getElementById('sentinel').click();
			});</script>`,
			channel
		);
		expect((await message).detail?.href).toBe("http://example.com/after");
	});

	it("still forwards uncaught errors", async () => {
		const channel = "test_errors";
		const message = nextMessage(channel);
		renderPreview(
			`<script>window.addEventListener('load', function(){ setTimeout(function(){ throw new Error('boom'); }, 0); });</script>`,
			channel
		);
		const received = await message;
		expect(received.type).toBe("chatui.preview.error");
		expect(received.detail?.message).toContain("boom");
	});
});
