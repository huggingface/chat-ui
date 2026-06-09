import type { ArtifactKind } from "./artifacts";

/**
 * Builders for sandboxed iframe `srcdoc` documents used by live previews
 * (artifact panel and the fullscreen HTML preview modal).
 *
 * Every document gets an error hook that forwards uncaught errors and
 * unhandled rejections to the parent via postMessage on a per-preview
 * channel, plus a script that disables link navigation inside the preview.
 */

const END_SCRIPT_TAG = "</scr" + "ipt>";

function buildErrorHookScript(channel: string): string {
	return `\n<script>\n(function(){\n  function send(detail){\n    try{ parent.postMessage({ type: 'chatui.preview.error', channel: '${channel}', detail: detail }, '*'); }catch(e){}\n  }\n  function markDisabled(anchor){\n    if (!anchor || anchor.dataset.chatuiLinkDisabled === 'true') return;\n    anchor.dataset.chatuiLinkDisabled = 'true';\n    var note = 'Link disabled in preview';\n    var title = anchor.getAttribute('title');\n    if (!title) {\n      anchor.setAttribute('title', note);\n    } else if (title.indexOf(note) === -1) {\n      anchor.setAttribute('title', title + ' — ' + note);\n    }\n  }\n  function disableAnchors(scope){\n    try {\n      var root = scope && scope.querySelectorAll ? scope : document;\n      var anchors = root.querySelectorAll ? root.querySelectorAll('a') : [];\n      for (var i = 0; i < anchors.length; i++) {\n        markDisabled(anchors[i]);\n      }\n    } catch (err) {}\n  }\n  function nearestAnchor(node){\n    while (node && node !== document) {\n      if (node.tagName && node.tagName.toLowerCase() === 'a') return node;\n      node = node.parentNode;\n    }\n    return null;\n  }\n  function intercept(ev){\n    var anchor = nearestAnchor(ev.target);\n    if (!anchor) return;\n    markDisabled(anchor);\n    ev.preventDefault();\n    ev.stopPropagation();\n  }\n  disableAnchors();\n  if (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', function(){ disableAnchors(); });\n  } else {\n    setTimeout(function(){ disableAnchors(); }, 0);\n  }\n  if (window.MutationObserver) {\n    var observer = new MutationObserver(function(mutations){\n      for (var i = 0; i < mutations.length; i++) {\n        var nodes = mutations[i].addedNodes;\n        for (var j = 0; j < nodes.length; j++) {\n          var node = nodes[j];\n          if (!node || node.nodeType !== 1) continue;\n          if (node.tagName && node.tagName.toLowerCase() === 'a') {\n            markDisabled(node);\n          } else {\n            disableAnchors(node);\n          }\n        }\n      }\n    });\n    observer.observe(document.documentElement, { childList: true, subtree: true });\n  }\n  window.addEventListener('click', intercept, true);\n  window.addEventListener('auxclick', intercept, true);\n  window.addEventListener('keydown', function(ev){\n    if (ev.key === 'Enter' || ev.key === ' ') {\n      intercept(ev);\n    }\n  }, true);\n  window.addEventListener('error', function(ev){\n    var msg = ev && ev.message ? ev.message : 'Script error';\n    var stack = ev && ev.error && ev.error.stack ? ev.error.stack : undefined;\n    send({ message: msg, stack: stack });\n  });\n  window.addEventListener('unhandledrejection', function(ev){\n    var r = ev && ev.reason;\n    var msg = (typeof r === 'string') ? r : (r && r.message) ? r.message : 'Unhandled promise rejection';\n    var stack = r && r.stack ? r.stack : undefined;\n    send({ message: msg, stack: stack });\n  });\n})();\n${END_SCRIPT_TAG}`;
}

/** JSON-encode a string for embedding inside an inline <script>, escaping `</` so the HTML parser can't terminate the script early. */
function embedAsJsString(source: string): string {
	return JSON.stringify(source).replace(/<\//g, "<\\/");
}

/**
 * Build a srcdoc for raw HTML or SVG content. Injects <base target="_blank">,
 * link disabling and the error hook into the right spot of the document.
 */
export function buildHtmlSrcdoc(content: string, channel: string): string {
	const trimmed = content.trimStart();
	const svgPattern = /^(?:<\?xml[^>]*>\s*)?(?:<!doctype\s+svg[^>]*>\s*)?<svg[\s>]/i;
	const baseTag = '<base target="_blank">';
	const disabledLinkStyles = `<style>
		a[data-chatui-link-disabled] {}
	</style>`;
	const errorHook = buildErrorHookScript(channel);

	if (svgPattern.test(trimmed)) {
		const svgContent = trimmed
			.replace(/^(<\?xml[^>]*>\s*)/i, "")
			.replace(/^(<!doctype[^>]*>\s*)/i, "");
		// Explicit white canvas: SVGs are usually drawn for light backgrounds, and
		// the panel's iframe backing is dark in dark mode
		const svgBackground = "<style>html { background: #fff; }</style>";
		return `<!doctype html><html><head>${baseTag}${disabledLinkStyles}${svgBackground}${errorHook}</head><body>${svgContent}</body></html>`;
	}

	const headMatch = content.match(/<head[^>]*>/i);
	if (headMatch) {
		return content.replace(headMatch[0], headMatch[0] + baseTag + disabledLinkStyles + errorHook);
	}
	const htmlTagMatch = content.match(/<html[^>]*>/i);
	if (htmlTagMatch) {
		return content.replace(
			htmlTagMatch[0],
			htmlTagMatch[0] + "\n<head>" + baseTag + disabledLinkStyles + errorHook + "</head>"
		);
	}
	const doctypeMatch = content.match(/<!doctype[^>]*>/i);
	if (doctypeMatch) {
		const idx = content.indexOf(doctypeMatch[0]) + doctypeMatch[0].length;
		return (
			content.slice(0, idx) +
			"\n<head>" +
			baseTag +
			disabledLinkStyles +
			errorHook +
			"</head>" +
			content.slice(idx)
		);
	}
	return "<head>" + baseTag + disabledLinkStyles + errorHook + "</head>\n" + content;
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
	const errorHook = buildErrorHookScript(channel);
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">${errorHook}
<script src="https://cdn.tailwindcss.com">${END_SCRIPT_TAG}
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js">${END_SCRIPT_TAG}
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js">${END_SCRIPT_TAG}
<script src="https://unpkg.com/@babel/standalone@7/babel.min.js">${END_SCRIPT_TAG}
<style>html, body { margin: 0; min-height: 100%; }</style>
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
	const errorHook = buildErrorHookScript(channel);
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">${errorHook}
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
