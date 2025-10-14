<script lang="ts">
	import Modal from "./Modal.svelte";
	import { onMount, onDestroy } from "svelte";
	import CarbonCopy from "~icons/carbon/copy";

	interface Props {
		html: string;
		onclose?: () => void;
	}

	let { html, onclose }: Props = $props();

	let iframeEl: HTMLIFrameElement | undefined = $state();
	let channel = $state(`preview_${Math.random().toString(36).slice(2)}`);
	let errors: { message: string; stack?: string }[] = $state([]);

	function buildSrcdoc(content: string, channel: string): string {
		const trimmed = content.trimStart();
		const svgPattern = /^(?:<\?xml[^>]*>\s*)?(?:<!doctype\s+svg[^>]*>\s*)?<svg[\s>]/i;
		const baseTag = '<base target="_blank">';
		const disabledLinkStyles = `<style>
			a[data-chatui-link-disabled] {}
		</style>`;
		const endScriptTag = "</scr" + "ipt>";
		const errorHook = `\n<script>\n(function(){\n  function send(detail){\n    try{ parent.postMessage({ type: 'chatui.preview.error', channel: '${channel}', detail: detail }, '*'); }catch(e){}\n  }\n  function markDisabled(anchor){\n    if (!anchor || anchor.dataset.chatuiLinkDisabled === 'true') return;\n    anchor.dataset.chatuiLinkDisabled = 'true';\n    var note = 'Link disabled in preview';\n    var title = anchor.getAttribute('title');\n    if (!title) {\n      anchor.setAttribute('title', note);\n    } else if (title.indexOf(note) === -1) {\n      anchor.setAttribute('title', title + ' — ' + note);\n    }\n  }\n  function disableAnchors(scope){\n    try {\n      var root = scope && scope.querySelectorAll ? scope : document;\n      var anchors = root.querySelectorAll ? root.querySelectorAll('a') : [];\n      for (var i = 0; i < anchors.length; i++) {\n        markDisabled(anchors[i]);\n      }\n    } catch (err) {}\n  }\n  function nearestAnchor(node){\n    while (node && node !== document) {\n      if (node.tagName && node.tagName.toLowerCase() === 'a') return node;\n      node = node.parentNode;\n    }\n    return null;\n  }\n  function intercept(ev){\n    var anchor = nearestAnchor(ev.target);\n    if (!anchor) return;\n    markDisabled(anchor);\n    ev.preventDefault();\n    ev.stopPropagation();\n  }\n  disableAnchors();\n  if (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', function(){ disableAnchors(); });\n  } else {\n    setTimeout(function(){ disableAnchors(); }, 0);\n  }\n  if (window.MutationObserver) {\n    var observer = new MutationObserver(function(mutations){\n      for (var i = 0; i < mutations.length; i++) {\n        var nodes = mutations[i].addedNodes;\n        for (var j = 0; j < nodes.length; j++) {\n          var node = nodes[j];\n          if (!node || node.nodeType !== 1) continue;\n          if (node.tagName && node.tagName.toLowerCase() === 'a') {\n            markDisabled(node);\n          } else {\n            disableAnchors(node);\n          }\n        }\n      }\n    });\n    observer.observe(document.documentElement, { childList: true, subtree: true });\n  }\n  window.addEventListener('click', intercept, true);\n  window.addEventListener('auxclick', intercept, true);\n  window.addEventListener('keydown', function(ev){\n    if (ev.key === 'Enter' || ev.key === ' ') {\n      intercept(ev);\n    }\n  }, true);\n  window.addEventListener('error', function(ev){\n    var msg = ev && ev.message ? ev.message : 'Script error';\n    var stack = ev && ev.error && ev.error.stack ? ev.error.stack : undefined;\n    send({ message: msg, stack: stack });\n  });\n  window.addEventListener('unhandledrejection', function(ev){\n    var r = ev && ev.reason;\n    var msg = (typeof r === 'string') ? r : (r && r.message) ? r.message : 'Unhandled promise rejection';\n    var stack = r && r.stack ? r.stack : undefined;\n    send({ message: msg, stack: stack });\n  });\n})();\n${endScriptTag}`;

		if (svgPattern.test(trimmed)) {
			const svgContent = trimmed
				.replace(/^(<\?xml[^>]*>\s*)/i, "")
				.replace(/^(<!doctype[^>]*>\s*)/i, "");
			return `<!doctype html><html><head>${baseTag}${disabledLinkStyles}${errorHook}</head><body>${svgContent}</body></html>`;
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

	let srcdoc = $derived(buildSrcdoc(html, channel));

	type PreviewMessage = {
		type: string;
		channel: string;
		detail?: { message?: unknown; stack?: string };
	};

	function onMessage(ev: MessageEvent) {
		if (!iframeEl || ev.source !== iframeEl.contentWindow) return;
		const raw = ev.data as unknown;
		if (!raw || typeof raw !== "object") return;
		const data = raw as Partial<PreviewMessage>;
		if (data.type !== "chatui.preview.error" || data.channel !== channel) return;
		const detail = (data.detail ?? {}) as { message?: unknown; stack?: string };
		errors = [...errors, { message: String(detail.message ?? "Error"), stack: detail.stack }];
	}

	onMount(() => {
		window.addEventListener("message", onMessage);
	});
	onDestroy(() => {
		window.removeEventListener("message", onMessage);
		if (copyTimer) clearTimeout(copyTimer);
	});

	function composeText(): string {
		const lines = errors.map((e, i) => `${i + 1}. ${e.message}${e.stack ? `\n${e.stack}` : ""}`);
		const summary = lines[0] ?? "Unknown error";
		return errors.length > 1
			? `it's not working: ${summary} (+${errors.length - 1} more) - can you fix it?`
			: `it's not working: ${summary} - can you fix it?`;
	}

	async function copy(text: string) {
		try {
			if (navigator.clipboard && window.isSecureContext) {
				await navigator.clipboard.writeText(text);
			} else {
				const ta = document.createElement("textarea");
				ta.value = text;
				ta.style.position = "fixed";
				ta.style.left = "-9999px";
				document.body.appendChild(ta);
				ta.focus();
				ta.select();
				document.execCommand("copy");
				document.body.removeChild(ta);
			}
			copied = true;
			clearTimeout(copyTimer);
			copyTimer = setTimeout(() => (copied = false), 1200);
		} catch (e) {
			console.error("Copy failed", e);
		}
	}

	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout>;

	function handleKeydown(event: KeyboardEvent) {
		// Close preview on ESC key
		if (event.key === "Escape") {
			event.preventDefault();
			onclose?.();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<Modal width="max-w-[90dvw]" closeButton onclose={() => onclose?.()}>
	<div class="p-4">
		<div class="relative h-[90dvh] w-[80dvw]">
			<iframe
				bind:this={iframeEl}
				title="HTML Preview"
				class="h-full w-full rounded-lg border border-gray-200 dark:border-gray-700"
				sandbox="allow-scripts allow-popups"
				referrerpolicy="no-referrer"
				{srcdoc}
			></iframe>

			{#if errors.length > 0}
				<button
					class="btn absolute bottom-4 right-4 flex items-center gap-2 rounded-full border-2 border-red-500/60 bg-red-800/90 px-4 py-1.5 text-sm text-white shadow-lg"
					title="Copy error"
					onclick={() => copy(composeText())}
				>
					<CarbonCopy class="text-xs" />
					<span>{copied ? "Copied" : `Error caught (${errors.length})`}</span>
				</button>
			{/if}
		</div>
	</div>
</Modal>
