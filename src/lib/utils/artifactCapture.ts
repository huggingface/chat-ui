/**
 * Screenshot capture for artifact preview iframes.
 *
 * The preview iframe is sandboxed with an opaque origin, so the parent can
 * never reach into its DOM. Capture therefore runs inside the iframe: the
 * hook script injected by previewSrcdoc.ts listens for a capture request
 * carrying the SnapDOM library source, injects it, renders the document to
 * a canvas and posts back a PNG data URL. The library is bundled at build
 * time (lazy chunk, loaded on first use) instead of fetched from a CDN
 * inside the iframe, so capture works offline and the version stays pinned.
 *
 * Everything that comes back crosses a trust boundary — the iframe runs
 * model-generated code — so results are validated here: the response must
 * match the pending request id, be a bounded-size PNG data URL, and carry
 * the PNG magic bytes.
 */

const CAPTURE_TIMEOUT_MS = 15_000;
/** ~9MB decoded; the server rejects attachments over 10MB */
const MAX_DATA_URL_LENGTH = 12_000_000;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

let snapdomSourcePromise: Promise<string> | undefined;

function loadCaptureLibrarySource(): Promise<string> {
	// Direct file import: the package's `exports` map doesn't expose ./dist/*,
	// and we need the text of the browser build (it assigns window.snapdom) to
	// inject into the sandboxed iframe. `?url` emits the file as a hashed
	// static asset fetched on first use — unlike `?raw`, which would inline it
	// as an escaped string in a JS chunk at roughly twice the bytes.
	snapdomSourcePromise ??= import("../../../node_modules/@zumer/snapdom/dist/snapdom.js?url")
		.then((mod) => fetch(mod.default))
		.then((res) => {
			if (!res.ok) throw new Error("could not load the capture library");
			return res.text();
		})
		.catch((err) => {
			// Don't memoize a transient failure (offline blip): let a later
			// capture attempt retry the download
			snapdomSourcePromise = undefined;
			throw err;
		});
	return snapdomSourcePromise;
}

/** True for a plausible PNG data URL: exact mime prefix plus PNG magic bytes. */
function isPngDataUrl(value: string): boolean {
	if (!value.startsWith(PNG_DATA_URL_PREFIX)) return false;
	try {
		// 12 base64 chars decode to the first 9 bytes; the PNG signature is 8
		const head = atob(value.slice(PNG_DATA_URL_PREFIX.length, PNG_DATA_URL_PREFIX.length + 12));
		return head.startsWith("\x89PNG\r\n\x1a\n");
	} catch {
		return false;
	}
}

/**
 * Ask the preview iframe to render itself to a PNG. Resolves with a validated
 * PNG data URL, rejects on error, oversize result, or timeout.
 *
 * @param backgroundColor fill for documents with a transparent background, so
 * the shot matches the panel backing the user actually sees (light vs dark).
 */
export function captureArtifactScreenshot(
	iframe: HTMLIFrameElement,
	channel: string,
	backgroundColor: string,
	{ timeoutMs = CAPTURE_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<string> {
	if (!iframe.contentWindow) return Promise.reject(new Error("preview is not ready"));

	return new Promise<string>((resolve, reject) => {
		const id = `capture_${Math.random().toString(36).slice(2)}`;
		let settled = false;

		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("timed out waiting for the preview"));
		}, timeoutMs);
		function cleanup() {
			settled = true;
			clearTimeout(timer);
			window.removeEventListener("message", onMessage);
		}

		function onMessage(ev: MessageEvent) {
			// Same source/channel gating as the panel's own preview listener
			if (ev.source !== iframe.contentWindow) return;
			const raw = ev.data as unknown;
			if (!raw || typeof raw !== "object") return;
			const data = raw as {
				type?: unknown;
				channel?: unknown;
				detail?: { id?: unknown; dataUrl?: unknown; error?: unknown };
			};
			if (data.channel !== channel || data.type !== "chatui.preview.captureResult") return;
			if (data.detail?.id !== id) return;
			cleanup();

			const dataUrl = data.detail.dataUrl;
			if (typeof dataUrl !== "string") {
				const error = data.detail.error;
				reject(new Error(typeof error === "string" && error ? error : "capture failed"));
				return;
			}
			if (dataUrl.length > MAX_DATA_URL_LENGTH) {
				reject(new Error("screenshot is too large to attach"));
				return;
			}
			if (!isPngDataUrl(dataUrl)) {
				reject(new Error("capture returned an invalid image"));
				return;
			}
			resolve(dataUrl);
		}

		window.addEventListener("message", onMessage);
		loadCaptureLibrarySource().then(
			(source) => {
				// The source fetch can outlive the timeout (first use on a slow
				// connection): a request posted after rejection would trigger an
				// expensive render whose response nobody listens for, and stacked
				// retries would fire several at once
				if (settled) return;
				// Re-read contentWindow: the iframe may have reloaded (srcdoc swap)
				// while the library chunk was loading
				iframe.contentWindow?.postMessage(
					{
						type: "chatui.preview.captureRequest",
						channel,
						detail: { id, source, backgroundColor },
					},
					"*"
				);
			},
			(err) => {
				if (settled) return;
				cleanup();
				reject(err instanceof Error ? err : new Error("could not load the capture library"));
			}
		);
	});
}

/** Decode a PNG data URL (already validated by the capture path) into a File. */
export function pngDataUrlToFile(dataUrl: string, fileName: string): File {
	const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return new File([bytes], fileName, { type: "image/png" });
}
