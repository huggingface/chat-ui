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

	const CODE_TAGS = new Set(["code", "pre"]);

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

		const citationPattern = /\s*\[(\d+(?:\s*,\s*\d+)*)\]/g;

		const replaceInSegment = (segment: string): string =>
			segment.replace(citationPattern, (match: string, group: string) => {
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
				return links ? `<sup class="ml-[2px] select-none">${links}</sup>` : match;
			});

		let result = "";
		let cursor = 0;
		const stack: string[] = [];

		const findTagEnd = (input: string, start: number): number => {
			let inQuote: string | null = null;
			for (let i = start + 1; i < input.length; i += 1) {
				const char = input[i];
				if (inQuote) {
					if (char === inQuote) {
						inQuote = null;
					}
					continue;
				}
				if (char === '"' || char === "'") {
					inQuote = char;
					continue;
				}
				if (char === ">") {
					return i;
				}
			}
			return input.length - 1;
		};

		const updateStack = (tagContent: string) => {
			const trimmed = tagContent.trim();
			if (!trimmed) return;
			const isClosing = trimmed.startsWith("/");
			const cleaned = isClosing ? trimmed.slice(1) : trimmed;
			const spaceIndex = cleaned.search(/\s|\/|$/);
			const rawName = spaceIndex === -1 ? cleaned : cleaned.slice(0, spaceIndex);
			const tagName = rawName.toLowerCase();
			const selfClosing = /\/$/.test(trimmed) || ["br", "hr", "img", "input", "meta", "link"].includes(tagName);
			if (CODE_TAGS.has(tagName)) {
				if (isClosing) {
					for (let i = stack.length - 1; i >= 0; i -= 1) {
						if (stack[i] === tagName) {
							stack.splice(i, 1);
							break;
						}
					}
				} else if (!selfClosing) {
					stack.push(tagName);
				}
			}
		};

		while (cursor < html.length) {
			const ltIndex = html.indexOf("<", cursor);
			if (ltIndex === -1) {
				const trailing = html.slice(cursor);
				result += stack.length === 0 ? replaceInSegment(trailing) : trailing;
				break;
			}

			const textSegment = html.slice(cursor, ltIndex);
			result += stack.length === 0 ? replaceInSegment(textSegment) : textSegment;

			const tagEnd = findTagEnd(html, ltIndex);
			const tag = html.slice(ltIndex, tagEnd + 1);
			result += tag;
			updateStack(html.slice(ltIndex + 1, tagEnd));
			cursor = tagEnd + 1;
		}

		return result;
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
