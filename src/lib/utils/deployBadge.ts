/**
 * "Made with HuggingChat" badge injected into artifacts deployed to a static
 * Space. Previews never get it — only the shipped `index.html`.
 *
 * The artifact page is arbitrary author HTML/CSS, so the badge is isolated on
 * both sides:
 *  - its markup lives in a **closed shadow root**, so page selectors (and page
 *    scripts) can't reach in, and the badge's own CSS can't leak out;
 *  - the host element's layout/paint properties are set as **inline
 *    `!important`** declarations, which outrank every author stylesheet rule
 *    (including `!important` ones), so a stray `div { display: none }` or
 *    `* { position: static }` can't hide or dislodge it. `all: initial` is set
 *    first to drop inherited values (font, color, visibility, transform…).
 *
 * A MutationObserver re-attaches the host if the page replaces `document.body`
 * content wholesale (common in artifacts that render a whole app into the body).
 */

const END_SCRIPT_TAG = "</scr" + "ipt>";

/** Attribute marking the badge host, also used as the idempotency check. */
export const BADGE_HOST_ATTRIBUTE = "data-huggingchat-badge";

const BADGE_URL = "https://huggingface.co/chat";
const BADGE_LABEL = "Made with HuggingChat";

// Same mark as static/huggingchat/logo.svg, inlined so the badge stays
// self-contained (a deployed Space must not depend on chat-ui being reachable).
const BADGE_LOGO = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16.0006 25.9992C13.8266 25.999 11.7118 25.2901 9.97686 23.9799C8.2419 22.6698 6.98127 20.8298 6.38599 18.7388C5.79071 16.6478 5.89323 14.4198 6.678 12.3923C7.46278 10.3648 8.88705 8.64837 10.735 7.50308C12.5829 6.35779 14.7538 5.84606 16.9187 6.04544C19.0837 6.24481 21.1246 7.14442 22.7323 8.60795C24.34 10.0715 25.4268 12.0192 25.8281 14.1559C26.2293 16.2926 25.9232 18.5019 24.9561 20.449C24.7703 20.8042 24.7223 21.2155 24.8211 21.604L25.4211 23.8316C25.4803 24.0518 25.4805 24.2837 25.4216 24.5039C25.3627 24.7242 25.2468 24.925 25.0856 25.0862C24.9244 25.2474 24.7235 25.3633 24.5033 25.4222C24.283 25.4811 24.0512 25.4809 23.831 25.4217L21.6034 24.8217C21.2172 24.7248 20.809 24.7729 20.4558 24.9567C19.0683 25.6467 17.5457 26.0068 16.0006 26.0068V25.9992Z" fill="currentColor"/><path d="M9.62598 16.0013C9.62598 15.3799 10.1294 14.8765 10.7508 14.8765C11.3721 14.8765 11.8756 15.3799 11.8756 16.0013C11.8756 17.0953 12.3102 18.1448 13.0838 18.9184C13.8574 19.692 14.9069 20.1266 16.001 20.1267C17.095 20.1267 18.1445 19.692 18.9181 18.9184C19.6918 18.1448 20.1264 17.0953 20.1264 16.0013C20.1264 15.3799 20.6299 14.8765 21.2512 14.8765C21.8725 14.8765 22.3759 15.3799 22.3759 16.0013C22.3759 17.6921 21.7046 19.3137 20.509 20.5093C19.3134 21.7049 17.6918 22.3762 16.001 22.3762C14.3102 22.3762 12.6885 21.7049 11.4929 20.5093C10.2974 19.3137 9.62598 17.6921 9.62598 16.0013Z" fill="#fff"/></svg>`;

const BADGE_SHADOW_HTML = `<style>
:host { all: initial; }
a {
  display: flex;
  align-items: center;
  gap: 5px;
  box-sizing: border-box;
  height: 26px;
  padding: 0 9px 0 7px;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.07);
  background: rgba(255, 255, 255, 0.92);
  -webkit-backdrop-filter: saturate(180%) blur(8px);
  backdrop-filter: saturate(180%) blur(8px);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 6px 16px rgba(0, 0, 0, 0.06);
  color: #111827;
  font: 500 11px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  letter-spacing: 0.01em;
  text-decoration: none;
  white-space: nowrap;
  opacity: 0.72;
  transition: opacity 0.15s ease, transform 0.15s ease;
}
a:hover, a:focus-visible { opacity: 1; transform: translateY(-1px); }
svg { width: 14px; height: 14px; flex: none; }
@media print { a { display: none; } }
</style><a href="${BADGE_URL}" target="_blank" rel="noopener noreferrer nofollow">${BADGE_LOGO}<span>${BADGE_LABEL}</span></a>`;

// Inline host styles, each applied with `important` so no author rule can win.
// Order matters: `all` resets everything, so it must come first.
const HOST_STYLES: Array<[string, string]> = [
	["all", "initial"],
	["position", "fixed"],
	["right", "12px"],
	["bottom", "12px"],
	["z-index", "2147483647"],
	["display", "block"],
	["visibility", "visible"],
	["opacity", "1"],
	["pointer-events", "auto"],
	["width", "auto"],
	["height", "auto"],
	["margin", "0"],
	["padding", "0"],
	["max-width", "none"],
	["max-height", "none"],
	["transform", "none"],
	["filter", "none"],
	["clip-path", "none"],
	["color-scheme", "light"],
];

function buildBadgeScript(): string {
	const shadowHtml = JSON.stringify(BADGE_SHADOW_HTML).replace(/<\//g, "<\\/");
	const hostStyles = JSON.stringify(HOST_STYLES);
	return `<script ${BADGE_HOST_ATTRIBUTE}="script">
(function () {
	try {
		if (document.querySelector("[${BADGE_HOST_ATTRIBUTE}]:not(script)")) return;
		var host = document.createElement("div");
		host.setAttribute("${BADGE_HOST_ATTRIBUTE}", "");
		var styles = ${hostStyles};
		for (var i = 0; i < styles.length; i++) {
			host.style.setProperty(styles[i][0], styles[i][1], "important");
		}
		host.attachShadow({ mode: "closed" }).innerHTML = ${shadowHtml};
		function attach() {
			var parent = document.body || document.documentElement;
			if (parent && host.parentNode !== parent) parent.appendChild(host);
		}
		attach();
		// Artifacts that rewrite document.body wholesale would drop the badge.
		if (document.body && typeof MutationObserver === "function") {
			new MutationObserver(attach).observe(document.body, { childList: true });
		} else {
			document.addEventListener("DOMContentLoaded", attach);
		}
	} catch (e) {}
})();
${END_SCRIPT_TAG}`;
}

/**
 * Append the badge to a complete HTML document. The script goes at the very
 * end, after `</html>` — the parser's "after after body" mode reparents it into
 * `<body>`, so it runs exactly as it would from inside the document. Everything
 * before it is left byte-for-byte untouched.
 *
 * Deliberately no search for a `</body>` to inject before: the artifact is
 * arbitrary author HTML, so a textual match can land inside a trailing script's
 * string literal or an HTML comment — where the badge's own `</script>` would
 * terminate the artifact's script and corrupt the page — and scanning for the
 * *last* match is quadratic on content that repeats the tag. Appending has
 * neither problem and produces the same result in the browser.
 */
export function appendHuggingChatBadge(html: string): string {
	return html + "\n" + buildBadgeScript() + "\n";
}
