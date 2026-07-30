import { afterEach, describe, expect, it } from "vitest";
import { buildHtmlSrcdoc, PREVIEW_ALLOW, PREVIEW_SANDBOX } from "$lib/utils/previewSrcdoc";
import { captureArtifactScreenshot } from "$lib/utils/artifactCapture";

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

	it("does not forward javascript:, relative, or in-page fragment links", async () => {
		const channel = "test_blocked";
		const message = nextMessage(channel);
		// None of the blocked clicks may produce a message, so the sentinel link
		// clicked last must be the first message observed. Relative hrefs would
		// resolve against the app's own origin (srcdoc inherits the parent base
		// URL) and must stay blocked.
		renderPreview(
			`<a id="js" href="javascript:void(0)">js</a>
			<a id="rel" href="/settings">relative</a>
			<a id="rel2" href="models/foo">relative 2</a>
			<a id="proto" href="//example.com/x">protocol-relative</a>
			<a id="frag" href="#section">frag</a>
			<div id="section"></div>
			<a id="sentinel" href="http://example.com/after">ok</a>
			<script>window.addEventListener('load', function(){
				document.getElementById('js').click();
				document.getElementById('rel').click();
				document.getElementById('rel2').click();
				document.getElementById('proto').click();
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

/** Decode a PNG data URL and read one pixel */
async function decodePixel(dataUrl: string, x: number, y: number): Promise<Uint8ClampedArray> {
	const img = new Image();
	img.src = dataUrl;
	await img.decode();
	const canvas = document.createElement("canvas");
	canvas.width = img.naturalWidth;
	canvas.height = img.naturalHeight;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no 2d canvas context");
	ctx.drawImage(img, 0, 0);
	return ctx.getImageData(x, y, 1, 1).data;
}

describe("preview screenshot capture", () => {
	// Full round trip through the real machinery: the request (carrying the
	// capture library) crosses into the sandboxed iframe, the document renders
	// itself, and the parent validates the PNG that comes back.
	it(
		"captures the preview document to a PNG whose pixels match the content",
		{ timeout: 20_000 },
		async () => {
			const channel = "test_capture";
			const iframe = renderPreview(
				`<div style="width:120px;height:120px;background:#ff0000"></div>`,
				channel
			);
			await new Promise<void>((resolve) =>
				iframe.addEventListener("load", () => resolve(), { once: true })
			);

			const dataUrl = await captureArtifactScreenshot(iframe, channel, "#ffffff");
			expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);

			// The red square sits at the body margin origin (8,8); probe inside it,
			// and outside it where the white background fill should show
			const inside = await decodePixel(dataUrl, 30, 30);
			expect(inside[3]).toBe(255);
			expect(inside[0]).toBeGreaterThan(200);
			expect(inside[1]).toBeLessThan(60);
			expect(inside[2]).toBeLessThan(60);

			const outside = await decodePixel(dataUrl, 200, 30);
			expect(outside[0]).toBeGreaterThan(200);
			expect(outside[1]).toBeGreaterThan(200);
			expect(outside[2]).toBeGreaterThan(200);
		}
	);

	// Regression: SnapDOM renders the <html> element as background-only for
	// full-viewport layouts (flex-centered body with min-height:100vh), which
	// is the shape most generated apps take — the hook must capture the body.
	it(
		"captures full-viewport flex layouts, not just the background",
		{ timeout: 20_000 },
		async () => {
			const channel = "test_capture_flex";
			const iframe = renderPreview(
				`<style>
				* { margin: 0; }
				body {
					display: flex; align-items: center; justify-content: center;
					min-height: 100vh;
					background: linear-gradient(135deg, #1a0b2e 0%, #2d1b4e 100%);
				}
			</style>
			<div style="width:40px;height:40px;background:#c084fc"></div>`,
				channel
			);
			await new Promise<void>((resolve) =>
				iframe.addEventListener("load", () => resolve(), { once: true })
			);
			const dataUrl = await captureArtifactScreenshot(iframe, channel, "#0a0a0a");
			const corner = await decodePixel(dataUrl, 10, 10);
			// Gradient start #1a0b2e — not the #0a0a0a backing fill, not transparent
			expect(corner[3]).toBe(255);
			expect(corner[2]).toBeGreaterThan(30);
			expect(corner[2]).toBeLessThan(90);
		}
	);

	// Regression: a decorative layer wider than the viewport (200% wave strips,
	// off-screen parallax elements) must not widen the shot — the capture keeps
	// the visible width instead of the horizontal scroll extent, so the image
	// doesn't come back with a dead band of background fill on the right.
	it("clips horizontal overflow to the visible width", { timeout: 20_000 }, async () => {
		const channel = "test_capture_overflow";
		const iframe = renderPreview(
			`<style>
				* { margin: 0; }
				body { min-height: 100vh; background: #1a0b2e; }
			</style>
			<div style="width:200%;height:40px;background:#c084fc"></div>`,
			channel
		);
		await new Promise<void>((resolve) =>
			iframe.addEventListener("load", () => resolve(), { once: true })
		);
		const dataUrl = await captureArtifactScreenshot(iframe, channel, "#0a0a0a");
		const img = new Image();
		img.src = dataUrl;
		await img.decode();
		// Default test iframe is 300 CSS px wide; the 200% child must not double it
		expect(img.naturalWidth).toBeLessThanOrEqual(300);
		// The purple page background still reaches the right edge of the shot
		const rightEdge = await decodePixel(dataUrl, img.naturalWidth - 5, img.naturalHeight - 5);
		expect(rightEdge[2]).toBeGreaterThan(30);
	});

	// Regression: pages that paint their background on <html> (body left
	// transparent) must keep that background in the shot, not receive the
	// panel backing passed by the parent.
	it("keeps a background painted on the html element", { timeout: 20_000 }, async () => {
		const channel = "test_capture_root_bg";
		const iframe = renderPreview(
			`<style>html { background: #008080; }</style>
			<div style="width:40px;height:40px"></div>`,
			channel
		);
		await new Promise<void>((resolve) =>
			iframe.addEventListener("load", () => resolve(), { once: true })
		);
		const dataUrl = await captureArtifactScreenshot(iframe, channel, "#0a0a0a");
		const corner = await decodePixel(dataUrl, 10, 10);
		// Teal from the html rule, not the #0a0a0a backing
		expect(corner[0]).toBeLessThan(40);
		expect(corner[1]).toBeGreaterThan(90);
		expect(corner[2]).toBeGreaterThan(90);
	});

	it("rejects when the preview never answers", async () => {
		const iframe = document.createElement("iframe");
		iframe.sandbox.add("allow-scripts");
		// A document without the hook script: the request goes nowhere
		iframe.srcdoc = "<!doctype html><html><body></body></html>";
		document.body.appendChild(iframe);
		iframes.push(iframe);
		await new Promise<void>((resolve) =>
			iframe.addEventListener("load", () => resolve(), { once: true })
		);
		await expect(
			captureArtifactScreenshot(iframe, "test_capture_missing", "#ffffff", { timeoutMs: 500 })
		).rejects.toThrow(/timed out/);
	});
});

/**
 * Mount a srcdoc iframe with the given attributes and run a probe script in
 * it; the script must post exactly one message on `channel` with its results.
 * The frame has an opaque origin the test cannot reach into, so results only
 * travel via postMessage.
 */
function runInPreviewFrame(
	channel: string,
	attrs: { sandbox: string; allow?: string },
	script: string
): Promise<Record<string, unknown>> {
	const result = nextMessage(channel).then((msg) => (msg.detail ?? {}) as Record<string, unknown>);
	const iframe = document.createElement("iframe");
	iframe.setAttribute("sandbox", attrs.sandbox);
	if (attrs.allow) iframe.setAttribute("allow", attrs.allow);
	iframe.srcdoc = buildHtmlSrcdoc(
		`<!doctype html><html><head></head><body><script>var CHANNEL=${JSON.stringify(
			channel
		)};${script}</scr` + `ipt></body></html>`,
		channel
	);
	document.body.appendChild(iframe);
	iframes.push(iframe);
	return result;
}

describe("preview iframe capability grants", () => {
	// The attribute strings are a security contract; lock the load-bearing
	// tokens at the source so a rewording can't silently weaken them.
	it("never grants same-origin, popups, or downloads", () => {
		expect(PREVIEW_SANDBOX).not.toContain("allow-same-origin");
		expect(PREVIEW_SANDBOX).not.toContain("allow-popups");
		expect(PREVIEW_SANDBOX).not.toContain("allow-downloads");
		expect(PREVIEW_SANDBOX).not.toContain("allow-top-navigation");
		for (const feature of ["camera", "microphone", "geolocation", "clipboard-read"]) {
			expect(PREVIEW_ALLOW).not.toContain(feature);
		}
	});

	it("delegates device-UX features to the frame but keeps privacy-sensitive ones and escape hatches blocked", async () => {
		const res = await runInPreviewFrame(
			"test_capabilities",
			{ sandbox: PREVIEW_SANDBOX, allow: PREVIEW_ALLOW },
			`(function(){
				var out = {};
				var fp = document.featurePolicy || document.permissionsPolicy;
				out.fullscreenEnabled = document.fullscreenEnabled;
				var names = ['accelerometer','gyroscope','magnetometer','gamepad','autoplay','clipboard-write','screen-wake-lock','camera','microphone','geolocation','clipboard-read','display-capture'];
				for (var i = 0; i < names.length; i++) {
					try { out[names[i]] = fp ? fp.allowsFeature(names[i]) : null; } catch (e) { out[names[i]] = 'err'; }
				}
				try { out.windowOpen = String(window.open('https://example.com/x')); } catch (e) { out.windowOpen = 'throw:' + e.name; }
				try { void window.localStorage; out.storage = 'accessible'; } catch (e) { out.storage = 'throws'; }
				parent.postMessage({ type: 'probe.result', channel: CHANNEL, detail: out }, '*');
			})();`
		);
		// Granted: what artifact games/tools legitimately use
		expect(res.fullscreenEnabled).toBe(true);
		expect(res.accelerometer).toBe(true);
		expect(res.gyroscope).toBe(true);
		expect(res.magnetometer).toBe(true);
		expect(res.gamepad).toBe(true);
		expect(res.autoplay).toBe(true);
		expect(res["clipboard-write"]).toBe(true);
		expect(res["screen-wake-lock"]).toBe(true);
		// Denied: reads of user data and devices
		expect(res.camera).toBe(false);
		expect(res.microphone).toBe(false);
		expect(res.geolocation).toBe(false);
		expect(res["clipboard-read"]).toBe(false);
		expect(res["display-capture"]).toBe(false);
		// Denied: leaving the sandbox (popups) and the app origin's storage
		expect(res.windowOpen).toBe("null");
		expect(res.storage).toBe("throws");
	});

	// Pointer lock is gated by the sandbox token, not the permissions policy.
	// Headless frames can't actually acquire the lock (no focus, no gesture),
	// so assert on WHY the request fails: with the production attributes the
	// failure must not be the sandbox refusal; a control frame without the
	// token proves the probe would catch that refusal.
	const POINTER_LOCK_PROBE = `(function(){
		var done = false;
		function finish(v){ if (done) return; done = true; parent.postMessage({ type: 'probe.result', channel: CHANNEL, detail: { pointerLock: v } }, '*'); }
		document.addEventListener('pointerlockerror', function(){ finish('event:pointerlockerror'); });
		window.addEventListener('load', function(){
			try {
				var r = document.body.requestPointerLock();
				if (r && r.then) r.then(function(){ finish('locked'); }, function(e){ finish(e.name + ': ' + e.message); });
				setTimeout(function(){ finish('no-error'); }, 2000);
			} catch (e) { finish(e.name + ': ' + e.message); }
		});
	})();`;

	it("does not sandbox-block pointer lock", async () => {
		const res = await runInPreviewFrame(
			"test_pointer_lock",
			{ sandbox: PREVIEW_SANDBOX, allow: PREVIEW_ALLOW },
			POINTER_LOCK_PROBE
		);
		expect(String(res.pointerLock)).not.toMatch(/sandbox/i);
	});

	it("control: without allow-pointer-lock the sandbox refusal is observable", async () => {
		const res = await runInPreviewFrame(
			"test_pointer_lock_control",
			{ sandbox: "allow-scripts" },
			POINTER_LOCK_PROBE
		);
		expect(String(res.pointerLock)).toMatch(/sandbox/i);
	});
});
