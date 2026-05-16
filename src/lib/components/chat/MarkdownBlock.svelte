<script lang="ts">
	import type { Token } from "$lib/utils/marked";
	import CodeBlock from "../CodeBlock.svelte";
	import DOMPurify from "isomorphic-dompurify";

	interface Props {
		tokens: Token[];
		loading?: boolean;
	}

	let { tokens, loading = false }: Props = $props();

	const purifyConfig = {
		ALLOWED_TAGS: [
			'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'p', 'a', 'ul', 'ol',
			'nl', 'li', 'b', 'i', 'strong', 'em', 'strike', 'code', 'hr', 'br', 'div',
			'table', 'thead', 'caption', 'tbody', 'tr', 'th', 'td', 'pre', 'span'
		],
		FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
		FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
	};

	// Derive rendered tokens for memoization
	const renderedTokens = $derived(tokens);
</script>

{#each renderedTokens as token}
	{#if token.type === "text"}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html DOMPurify.sanitize(token.html || '', purifyConfig)}
	{:else if token.type === "code"}
		<CodeBlock code={token.code} rawCode={token.rawCode} loading={loading && !token.isClosed} />
	{/if}
{/each}
