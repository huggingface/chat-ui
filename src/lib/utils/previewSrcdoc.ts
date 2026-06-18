import type { ArtifactKind } from "./artifacts";

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
 */

const END_SCRIPT_TAG = "</scr" + "ipt>";

function buildPreviewHookScript(channel: string): string {
	// Deployed artifacts (a static Space) pass an empty channel: there is no
	// parent window to postMessage to, so the hook is omitted entirely and the
	// shipped document is just the artifact itself.
	if (!channel) return "";
	return `\n<script>\n(function(){\n  function send(type, detail){\n    try{ parent.postMessage({ type: type, channel: '${channel}', detail: detail }, '*'); }catch(e){}\n  }\n  function nearestAnchor(node){\n    while (node && node !== document) {\n      if (node.tagName && node.tagName.toLowerCase() === 'a') return node;\n      node = node.parentNode;\n    }\n    return null;\n  }\n  function anchorHref(anchor){\n    var href = anchor.href;\n    if (typeof href === 'string') return href;\n    if (href && typeof href.baseVal === 'string') {\n      try { return new URL(href.baseVal, document.baseURI).href; } catch (err) { return ''; }\n    }\n    return '';\n  }\n  function scrollToFragment(raw){\n    var id = raw.slice(1);\n    try { id = decodeURIComponent(id); } catch (err) {}\n    var target = id ? document.getElementById(id) : null;\n    if (target && target.scrollIntoView) target.scrollIntoView();\n  }\n  function intercept(ev){\n    var anchor = nearestAnchor(ev.target);\n    if (!anchor) return;\n    ev.preventDefault();\n    ev.stopPropagation();\n    var raw = anchor.getAttribute('href') || anchor.getAttribute('xlink:href') || '';\n    if (raw.charAt(0) === '#') {\n      scrollToFragment(raw);\n      return;\n    }\n    if (!/^\\s*https?:/i.test(raw)) return;\n    var href = anchorHref(anchor);\n    if (/^https?:/i.test(href)) {\n      send('chatui.preview.openLink', { href: href });\n    }\n  }\n  window.addEventListener('click', intercept, true);\n  window.addEventListener('auxclick', intercept, true);\n  window.addEventListener('keydown', function(ev){\n    if (ev.key === 'Enter' || ev.key === ' ') {\n      intercept(ev);\n    }\n  }, true);\n  window.addEventListener('error', function(ev){\n    var msg = ev && ev.message ? ev.message : 'Script error';\n    var stack = ev && ev.error && ev.error.stack ? ev.error.stack : undefined;\n    send('chatui.preview.error', { message: msg, stack: stack });\n  });\n  window.addEventListener('unhandledrejection', function(ev){\n    var r = ev && ev.reason;\n    var msg = (typeof r === 'string') ? r : (r && r.message) ? r.message : 'Unhandled promise rejection';\n    var stack = r && r.stack ? r.stack : undefined;\n    send('chatui.preview.error', { message: msg, stack: stack });\n  });\n})();\n${END_SCRIPT_TAG}`;
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
 * verbatim — it is already a complete self-contained page and we must not inject
 * a `<base target="_blank">` that would rewrite its link behaviour. SVG/React/
 * Mermaid reuse the same wrappers as the preview, minus the hook.
 */
export function buildDeployableHtml(kind: ArtifactKind, content: string): string {
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
