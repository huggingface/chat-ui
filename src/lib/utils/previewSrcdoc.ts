import type { ArtifactKind } from "./artifacts";
import { appendHuggingChatBadge } from "./deployBadge";

/**
 * Builders for sandboxed iframe `srcdoc` documents used by live previews
 * (artifact panel and the fullscreen HTML preview modal).
 *
 * Every document gets a hook script that forwards uncaught errors and
 * unhandled rejections to the parent via postMessage on a per-preview
 * channel. The same script intercepts link activation: in-page fragment
 * links scroll within the preview, links whose raw href is an absolute
 * http(s) URL are forwarded to the parent (which confirms before opening
 * a new tab), everything else is blocked. The raw-attribute check matters:
 * srcdoc documents inherit the parent's base URL, so a relative href would
 * resolve to an app-origin URL the artifact never legitimately points at —
 * and the confirm dialog would then show the app's own trusted hostname
 * over an attacker-chosen path. Navigating from inside the sandbox would
 * be broken anyway — the opened tab would inherit the sandbox's opaque
 * origin.
 *
 * The hook also answers screenshot requests from the parent (see
 * artifactCapture.ts): the sandbox has an opaque origin the parent cannot
 * reach into, so the parent sends the capture library's source over
 * postMessage and the document renders itself to a PNG data URL in-process.
 */

const END_SCRIPT_TAG = "</scr" + "ipt>";

/** An uncaught error forwarded from a preview iframe via the postMessage hook. */
export interface PreviewError {
	message: string;
	stack?: string;
}

/**
 * Cap on stored preview errors: a handler that throws every frame or click
 * emits the same error endlessly, and each append rebuilds the captured list.
 * Beyond this the extras carry no new signal for a fix request anyway.
 */
export const MAX_CAPTURED_PREVIEW_ERRORS = 100;

const MAX_DISTINCT_ERRORS = 5;
const MAX_STACK_LINES = 5;
const MAX_ERROR_CHARS = 700;

function renderError({ error, count }: { error: PreviewError; count: number }): string {
	const times = count > 1 ? ` (repeated ${count} times)` : "";
	// Keep only the top of the stack: for single-file artifacts the first
	// frames carry the useful location, and deep stacks would drown the list
	const stack = error.stack?.split("\n").slice(0, MAX_STACK_LINES).join("\n") ?? "";
	const rendered = `${error.message}${times}${stack ? `\n${stack}` : ""}`;
	return rendered.length > MAX_ERROR_CHARS ? `${rendered.slice(0, MAX_ERROR_CHARS)}…` : rendered;
}

/** The chat message sent when the user asks the model to fix captured preview errors. */
export function composeFixRequest(errors: PreviewError[]): string {
	// Collapse repeats (a throwing rAF/event handler emits the same error over
	// and over) so each distinct failure is listed once, with a count
	const distinct = new Map<string, { error: PreviewError; count: number }>();
	for (const error of errors) {
		const key = `${error.message}\n${error.stack ?? ""}`;
		const entry = distinct.get(key);
		if (entry) entry.count += 1;
		else distinct.set(key, { error, count: 1 });
	}
	const entries = [...distinct.values()];

	if (entries.length <= 1) {
		const summary = entries.length ? renderError(entries[0]) : "Unknown error";
		return `it's not working: ${summary} - can you fix it?`;
	}

	const shown = entries.slice(0, MAX_DISTINCT_ERRORS);
	const omitted = entries.length - shown.length;
	const list = shown.map((entry, i) => `${i + 1}. ${renderError(entry)}`).join("\n");
	const tail = omitted > 0 ? `\n(+${omitted} more distinct error${omitted > 1 ? "s" : ""})` : "";
	return `it's not working, I see ${entries.length} errors:\n${list}${tail}\ncan you fix them?`;
}

function buildPreviewHookScript(channel: string): string {
	// Deployed artifacts (a static Space) pass an empty channel: there is no
	// parent window to postMessage to, so the hook is omitted entirely and the
	// shipped document is just the artifact itself.
	if (!channel) return "";
	return `\n<script>
(function(){
  function send(type, detail){
    try{ parent.postMessage({ type: type, channel: '${channel}', detail: detail }, '*'); }catch(e){}
  }
  function nearestAnchor(node){
    while (node && node !== document) {
      if (node.tagName && node.tagName.toLowerCase() === 'a') return node;
      node = node.parentNode;
    }
    return null;
  }
  function anchorHref(anchor){
    var href = anchor.href;
    if (typeof href === 'string') return href;
    if (href && typeof href.baseVal === 'string') {
      try { return new URL(href.baseVal, document.baseURI).href; } catch (err) { return ''; }
    }
    return '';
  }
  function scrollToFragment(raw){
    var id = raw.slice(1);
    try { id = decodeURIComponent(id); } catch (err) {}
    var target = id ? document.getElementById(id) : null;
    if (target && target.scrollIntoView) target.scrollIntoView();
  }
  function intercept(ev){
    var anchor = nearestAnchor(ev.target);
    if (!anchor) return;
    ev.preventDefault();
    ev.stopPropagation();
    var raw = anchor.getAttribute('href') || anchor.getAttribute('xlink:href') || '';
    if (raw.charAt(0) === '#') {
      scrollToFragment(raw);
      return;
    }
    if (!/^\\s*https?:/i.test(raw)) return;
    var href = anchorHref(anchor);
    if (/^https?:/i.test(href)) {
      send('chatui.preview.openLink', { href: href });
    }
  }
  window.addEventListener('click', intercept, true);
  window.addEventListener('auxclick', intercept, true);
  window.addEventListener('keydown', function(ev){
    if (ev.key === 'Enter' || ev.key === ' ') {
      intercept(ev);
    }
  }, true);
  window.addEventListener('error', function(ev){
    var msg = ev && ev.message ? ev.message : 'Script error';
    var stack = ev && ev.error && ev.error.stack ? ev.error.stack : undefined;
    send('chatui.preview.error', { message: msg, stack: stack });
  });
  window.addEventListener('unhandledrejection', function(ev){
    var r = ev && ev.reason;
    var msg = (typeof r === 'string') ? r : (r && r.message) ? r.message : 'Unhandled promise rejection';
    var stack = r && r.stack ? r.stack : undefined;
    send('chatui.preview.error', { message: msg, stack: stack });
  });
  // Screenshots read WebGL canvases via toDataURL, which returns a blank
  // image once the frame's drawing buffer has been discarded. Default
  // preserveDrawingBuffer on (unless the artifact set it explicitly) so
  // three.js scenes and canvas games capture what's on screen. This hook
  // only exists in previews, so deployed pages keep stock behavior.
  var getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, attrs){
    if ((type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') &&
        (!attrs || attrs.preserveDrawingBuffer === undefined)) {
      attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    }
    return getContext.call(this, type, attrs);
  };
  window.addEventListener('message', function(ev){
    // Only the embedding app may request a capture. The artifact's own code
    // could still forge a request at itself, but that grants nothing it
    // can't already do, and the parent validates every result it receives.
    if (ev.source !== window.parent) return;
    var data = ev.data;
    if (!data || data.channel !== '${channel}' || data.type !== 'chatui.preview.captureRequest') return;
    var detail = data.detail || {};
    var id = typeof detail.id === 'string' ? detail.id : '';
    function fail(err){
      send('chatui.preview.captureResult', { id: id, error: String(err && err.message ? err.message : err) });
    }
    try {
      if (!window.snapdom) {
        if (typeof detail.source !== 'string' || !detail.source) { fail('capture library missing'); return; }
        var s = document.createElement('script');
        s.textContent = detail.source;
        (document.head || document.documentElement).appendChild(s);
        s.remove();
        if (!window.snapdom) { fail('capture library failed to initialize'); return; }
      }
      // Capture the body, not documentElement: SnapDOM renders the <html>
      // element as empty/background-only for common full-viewport layouts
      // (e.g. flex-centered body with min-height:100vh), while body capture
      // is reliable. Transparent areas get the backgroundColor fill below.
      var root = document.body || document.documentElement;
      var scrollWidth = Math.max(root.scrollWidth, root.clientWidth, 1);
      var height = Math.max(root.scrollHeight, root.clientHeight, 1);
      // Decorative layers wider than the viewport (200% wave strips, parallax
      // slides) widen SnapDOM's output into a dead band of background fill;
      // clip the shot to the visible width. Height is NOT clipped: capturing
      // tall documents full page is intentional.
      var visibleWidth = root.clientWidth > 0 ? Math.min(scrollWidth, root.clientWidth) : scrollWidth;
      // Cap the long edge so a tall page can't produce a giant payload
      var scale = Math.min(1, 4096 / Math.max(visibleWidth, height));
      // Body capture drops anything painted on <html>, so a page that styles
      // its background there (body transparent) would get the panel backing
      // instead of its own color: prefer the root's computed background when
      // it has one. Gradients/images on <html> stay out of reach (a fill
      // color is all the capture API takes), but those normally live on body.
      var rootBackground = '';
      try { rootBackground = getComputedStyle(document.documentElement).backgroundColor || ''; } catch (err) {}
      if (rootBackground === 'transparent' || rootBackground === 'rgba(0, 0, 0, 0)') rootBackground = '';
      window.snapdom.toCanvas(root, {
        dpr: 1,
        scale: scale,
        backgroundColor: rootBackground || (typeof detail.backgroundColor === 'string' && detail.backgroundColor ? detail.backgroundColor : '#ffffff'),
        embedFonts: true,
        fast: true
      }).then(function(canvas){
        var targetWidth = Math.round(visibleWidth * scale);
        if (canvas.width > targetWidth + 1) {
          var clipped = document.createElement('canvas');
          clipped.width = targetWidth;
          clipped.height = canvas.height;
          var clipCtx = clipped.getContext('2d');
          if (clipCtx) {
            clipCtx.drawImage(canvas, 0, 0);
            canvas = clipped;
          }
        }
        send('chatui.preview.captureResult', { id: id, dataUrl: canvas.toDataURL('image/png') });
      }).catch(fail);
    } catch (err) { fail(err); }
  });
})();
${END_SCRIPT_TAG}`;
}

/** JSON-encode a string for embedding inside an inline <script>, escaping `</` so the HTML parser can't terminate the script early. */
function embedAsJsString(source: string): string {
	return JSON.stringify(source).replace(/<\//g, "<\\/");
}

/**
 * Build a srcdoc for raw HTML or SVG content. Injects <base target="_blank">,
 * and the preview hook into the right spot of the document.
 */
export function buildHtmlSrcdoc(content: string, channel: string): string {
	const trimmed = content.trimStart();
	const svgPattern = /^(?:<\?xml[^>]*>\s*)?(?:<!doctype\s+svg[^>]*>\s*)?<svg[\s>]/i;
	const baseTag = '<base target="_blank">';
	const previewHook = buildPreviewHookScript(channel);

	if (svgPattern.test(trimmed)) {
		const svgContent = trimmed
			.replace(/^(<\?xml[^>]*>\s*)/i, "")
			.replace(/^(<!doctype[^>]*>\s*)/i, "");
		// Explicit white canvas: SVGs are usually drawn for light backgrounds, and
		// the panel's iframe backing is dark in dark mode
		const svgBackground = "<style>html { background: #fff; }</style>";
		return `<!doctype html><html><head>${baseTag}${svgBackground}${previewHook}</head><body>${svgContent}</body></html>`;
	}

	const headMatch = content.match(/<head[^>]*>/i);
	if (headMatch) {
		return content.replace(headMatch[0], headMatch[0] + baseTag + previewHook);
	}
	const htmlTagMatch = content.match(/<html[^>]*>/i);
	if (htmlTagMatch) {
		return content.replace(
			htmlTagMatch[0],
			htmlTagMatch[0] + "\n<head>" + baseTag + previewHook + "</head>"
		);
	}
	const doctypeMatch = content.match(/<!doctype[^>]*>/i);
	if (doctypeMatch) {
		const idx = content.indexOf(doctypeMatch[0]) + doctypeMatch[0].length;
		return (
			content.slice(0, idx) + "\n<head>" + baseTag + previewHook + "</head>" + content.slice(idx)
		);
	}
	return "<head>" + baseTag + previewHook + "</head>\n" + content;
}

const REACT_HOOK_PRELUDE = [
	"useState",
	"useEffect",
	"useMemo",
	"useCallback",
	"useRef",
	"useReducer",
	"useContext",
	"useLayoutEffect",
	"useId",
	"useTransition",
	"useDeferredValue",
	"useSyncExternalStore",
	"useImperativeHandle",
	"Fragment",
	"createContext",
	"memo",
	"forwardRef",
]
	.map((name) => `var ${name} = React.${name};`)
	.join(" ");

/**
 * Build a srcdoc that renders a single React component. The component source
 * is transformed in the iframe with Babel standalone (JSX + TypeScript),
 * imports are stripped (React and its hooks are provided as globals, Tailwind
 * classes work via the Play CDN), and the default export is rendered.
 */
export function buildReactSrcdoc(code: string, channel: string): string {
	const previewHook = buildPreviewHookScript(channel);
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">${previewHook}
<script src="https://cdn.tailwindcss.com">${END_SCRIPT_TAG}
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js">${END_SCRIPT_TAG}
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js">${END_SCRIPT_TAG}
<script src="https://unpkg.com/@babel/standalone@7/babel.min.js">${END_SCRIPT_TAG}
<style>html, body { margin: 0; min-height: 100%; background: #fff; }</style>
</head>
<body>
<div id="artifact-root"></div>
<script>
(function () {
	var source = ${embedAsJsString(code)};
	function fail(message) {
		var el = document.getElementById("artifact-root");
		if (el) {
			el.innerHTML = "";
			var pre = document.createElement("pre");
			pre.style.cssText = "color:#b91c1c;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;padding:16px;margin:0";
			pre.textContent = message;
			el.appendChild(pre);
		}
		setTimeout(function () { throw new Error(message); }, 0);
	}
	try {
		var prepared = source
			.replace(/^[ \\t]*import[^\\n]*$/gm, "")
			.replace(/^[ \\t]*export\\s+\\{[^}]*\\}\\s*;?[ \\t]*$/gm, "")
			.replace(/\\bexport\\s+default\\s+/, "window.__artifactDefault = ")
			.replace(/^([ \\t]*)export\\s+(const|let|var|function|class)/gm, "$1$2");
		var compiled = Babel.transform(prepared, {
			filename: "artifact.tsx",
			presets: [["react"], ["typescript", { isTSX: true, allExtensions: true }]],
		}).code;
		(0, eval)(${embedAsJsString(REACT_HOOK_PRELUDE)} + "\\n" + compiled);
		var Component = window.__artifactDefault;
		if (typeof Component === "undefined" || Component === null) {
			fail("No default export found. The artifact must use export default for its component.");
			return;
		}
		ReactDOM.createRoot(document.getElementById("artifact-root")).render(
			React.createElement(Component)
		);
	} catch (e) {
		fail(e && e.message ? e.message : String(e));
	}
})();
${END_SCRIPT_TAG}
</body>
</html>`;
}

/** Build a srcdoc that renders a Mermaid diagram, centered on a light canvas. */
export function buildMermaidSrcdoc(code: string, channel: string): string {
	const previewHook = buildPreviewHookScript(channel);
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">${previewHook}
<style>
html, body { margin: 0; min-height: 100%; background: #fff; }
#artifact-root { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; box-sizing: border-box; }
#artifact-root svg { max-width: 100%; height: auto; }
</style>
</head>
<body>
<div id="artifact-root"></div>
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
const code = ${embedAsJsString(code)};
mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
try {
	const { svg } = await mermaid.render("artifact-diagram", code);
	document.getElementById("artifact-root").innerHTML = svg;
} catch (e) {
	const pre = document.createElement("pre");
	pre.style.cssText = "color:#b91c1c;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;padding:16px;margin:0";
	pre.textContent = String((e && e.message) || e);
	const root = document.getElementById("artifact-root");
	root.innerHTML = "";
	root.appendChild(pre);
	setTimeout(() => { throw e; }, 0);
}
${END_SCRIPT_TAG}
</body>
</html>`;
}

/** Dispatch to the right srcdoc builder for an artifact kind. */
export function buildArtifactSrcdoc(kind: ArtifactKind, content: string, channel: string): string {
	switch (kind) {
		case "react":
			return buildReactSrcdoc(content, channel);
		case "mermaid":
			return buildMermaidSrcdoc(content, channel);
		default:
			return buildHtmlSrcdoc(content, channel);
	}
}

/** Kinds that can be shipped as a self-contained static page (an HF Space). */
export function isDeployableKind(kind: ArtifactKind): boolean {
	return kind === "html" || kind === "svg" || kind === "react" || kind === "mermaid";
}

/**
 * Build the standalone `index.html` shipped to a deployed static Space. Unlike
 * the preview builders this passes an empty channel, so the postMessage hook is
 * stripped (a deployed page has no parent window to talk to). Raw HTML is shipped
 * as-is — it is already a complete self-contained page and we must not inject
 * a `<base target="_blank">` that would rewrite its link behaviour. SVG/React/
 * Mermaid reuse the same wrappers as the preview, minus the hook.
 *
 * Every deployed page then gets the "Made with HuggingChat" badge appended (see
 * `deployBadge.ts`); it is self-contained and shadow-isolated, so it is the one
 * thing added to otherwise untouched artifact markup.
 */
export function buildDeployableHtml(kind: ArtifactKind, content: string): string {
	return appendHuggingChatBadge(buildDeployableDocument(kind, content));
}

function buildDeployableDocument(kind: ArtifactKind, content: string): string {
	switch (kind) {
		case "react":
			return buildReactSrcdoc(content, "");
		case "mermaid":
			return buildMermaidSrcdoc(content, "");
		case "svg":
			return buildHtmlSrcdoc(content, "");
		default:
			return content;
	}
}
