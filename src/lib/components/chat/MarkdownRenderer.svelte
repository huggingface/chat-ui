<script lang="ts">
	import { processTokens, processTokensSync, type Token } from "$lib/utils/marked";
	// import MarkdownWorker from "$lib/workers/markdownWorker?worker";
	import CodeBlock from "../CodeBlock.svelte";
	import type { IncomingMessage, OutgoingMessage } from "$lib/workers/markdownWorker";
	import { browser } from "$app/environment";

	import sanitizeHtml from "sanitize-html";
	import { updateDebouncer } from "$lib/utils/updates";

	interface Props {
		content: string;
		sources?: { title?: string; link: string }[];
		loading?: boolean;
	}

	let worker: Worker | null = null;

	let { content, sources = [], loading = false }: Props = $props();

	let tokens: Token[] = $state(processTokensSync(content, sources));

	async function processContent(
		content: string,
		sources: { title?: string; link: string }[]
	): Promise<Token[]> {
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
					JSON.parse(JSON.stringify({ content, sources, type: "process" })) as IncomingMessage
				);
			});
		} else {
			return processTokens(content, sources);
		}
	}

	$effect(() => {
		if (!browser) {
			tokens = processTokensSync(content, sources);
		} else {
			(async () => {
				updateDebouncer.startRender();
				tokens = await processContent(content, sources).then(
					async (tokens) =>
						await Promise.all(
							tokens.map(async (token) => {
								if (token.type === "text") {
									token.html = sanitizeHtml(await token.html, {
										allowedTags: sanitizeHtml.defaults.allowedTags.concat([
											"img",
											"svg",
											"path",
											"circle",
											"rect",
											"line",
											"polyline",
											"polygon",
											"ellipse",
											"g",
											"defs",
											"linearGradient",
											"radialGradient",
											"stop",
											"use",
											"symbol",
											"text",
											"tspan",
											"clipPath",
											"mask",
											"pattern",
										]),
										allowedAttributes: {
											...sanitizeHtml.defaults.allowedAttributes,
											a: ["href", "target", "rel"],
											img: ["src", "alt", "title", "width", "height"],
											svg: [
												"xmlns",
												"viewBox",
												"width",
												"height",
												"preserveAspectRatio",
												"class",
												"id",
												"fill",
												"stroke",
											],
											"*": [
												"class",
												"id",
												"fill",
												"stroke",
												"stroke-width",
												"d",
												"cx",
												"cy",
												"r",
												"x",
												"y",
												"x1",
												"y1",
												"x2",
												"y2",
												"points",
												"transform",
											],
										},
										transformTags: {
											a: (tagName, attribs) => ({
												tagName,
												attribs: {
													...attribs,
													target: "_blank",
													rel: "noreferrer",
												},
											}),
										},
										parser: {
											lowerCaseTags: false,
											lowerCaseAttributeNames: false,
										},
									});
								}
								return token;
							})
						)
				);

				updateDebouncer.endRender();
			})();
		}
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
