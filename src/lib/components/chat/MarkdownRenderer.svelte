<script lang="ts">
	import { processTokens, processTokensSync, type Token } from "$lib/utils/marked";
	// import MarkdownWorker from "$lib/workers/markdownWorker?worker";
	import CodeBlock from "../CodeBlock.svelte";
	import type { IncomingMessage, OutgoingMessage } from "$lib/workers/markdownWorker";
	import { browser } from "$app/environment";

	import DOMPurify from "isomorphic-dompurify";
	import { onMount } from "svelte";
	import { updateDebouncer } from "$lib/utils/updates";

	import type { MessageSource } from "$lib/types/MessageUpdate";

	interface Props {
		content: string;
		sources?: MessageSource[];
		loading?: boolean;
	}

	let worker: Worker | null = null;

	let { content, sources = [], loading = false }: Props = $props();

	let tokens: Token[] = $state(processTokensSync(content));

	function linkifyCitations(html: string, sources: MessageSource[]): string {
		if (!Array.isArray(sources) || sources.length === 0 || typeof html !== "string") return html;
		const hrefByIndex = new Map<number, string>();
		for (const s of sources) {
			const idx = Number(s.index);
			if (!Number.isFinite(idx) || idx <= 0) continue;
			try {
				const u = new URL(s.link);
				if (u.protocol === "http:" || u.protocol === "https:") {
					const safe = u.toString().replace(/"/g, "&quot;");
					hrefByIndex.set(idx, safe);
				}
			} catch {
				// ignore invalid URLs
			}
		}
		if (hrefByIndex.size === 0) return html;

		const parts = html.split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/gi);
		for (let i = 0; i < parts.length; i += 1) {
			const part = parts[i];
			if (/^<pre|^<code/i.test(part)) continue;
			parts[i] = part.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (m: string, group: string) => {
				const links = group
					.split(/\s*,\s*/)
					.map((d: string) => {
						const n = Number(d);
						const href = hrefByIndex.get(n);
						return href
							? `<a href="${href}" class="text-blue-500 underline-none no-underline">${n}</a>`
							: "";
					})
					.filter(Boolean)
					.join(", ");
				return links ? ` <sup>${links}</sup>` : m;
			});
		}
		return parts.join("");
	}

	async function processContent(content: string): Promise<Token[]> {
		if (worker) {
			return new Promise((resolve) => {
				if (!worker) {
					throw new Error("Worker not initialized");
				}
				worker.onmessage = (event: MessageEvent<OutgoingMessage>) => {
					if (event.data.type !== "processed") {
						throw new Error("Invalid message type");
					}
					resolve(event.data.tokens);
				};
				worker.postMessage(
					JSON.parse(JSON.stringify({ content, type: "process" })) as IncomingMessage
				);
			});
		} else {
			return processTokens(content);
		}
	}

	$effect(() => {
		if (!browser) {
			tokens = processTokensSync(content).map((t) =>
				t.type === "text" ? { ...t, html: linkifyCitations(t.html as string, sources) } : t
			);
		} else {
			(async () => {
				updateDebouncer.startRender();
				tokens = await processContent(content).then(
					async (tokens) =>
						await Promise.all(
							tokens.map(async (token) => {
								if (token.type === "text") {
									const raw = await token.html;
									const linked = linkifyCitations(raw, sources);
									token.html = DOMPurify.sanitize(linked);
								}
								return token;
							})
						)
				);

				updateDebouncer.endRender();
			})();
		}
	});

	onMount(() => {
		// todo: fix worker, seems to be transmitting a lot of data
		// worker = browser && window.Worker ? new MarkdownWorker() : null;

		DOMPurify.addHook("afterSanitizeAttributes", (node) => {
			if (node.tagName === "A") {
				node.setAttribute("target", "_blank");
				node.setAttribute("rel", "noreferrer");
			}
		});
	});
</script>

{#each tokens as token}
	{#if token.type === "text"}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html token.html}
	{:else if token.type === "code"}
		<CodeBlock code={token.code} rawCode={token.rawCode} loading={loading && !token.isClosed} />
	{/if}
{/each}
