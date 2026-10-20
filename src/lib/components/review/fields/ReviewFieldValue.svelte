<script lang="ts">
	import type { ReviewField, ReviewQuote } from "$lib/types/MlReview";
	import { imageUrl } from "$lib/utils/review/view";
	import type { AnchoredQuote } from "../quoteAnchors";
	import ChatField from "./ChatField.svelte";
	import CodeField from "./CodeField.svelte";
	import ImageField from "./ImageField.svelte";
	import JsonField from "./JsonField.svelte";
	import TextField from "./TextField.svelte";

	interface Props {
		field: ReviewField;
		value: unknown;
		clamp?: boolean;
		quotes?: AnchoredQuote[];
		onanchors?: (lost: string[]) => void;
		oncomment?: (quote: ReviewQuote) => void;
	}

	let { field, value, clamp = false, quotes, onanchors, oncomment }: Props = $props();
</script>

{#if value === undefined || value === null}
	<span class="text-sm text-gray-300 dark:text-gray-600">—</span>
{:else if field.type === "text" || field.type === "markdown"}
	<TextField
		value={String(value)}
		markdown={field.type === "markdown"}
		{clamp}
		{quotes}
		{onanchors}
		{oncomment}
	/>
{:else if field.type === "code"}
	<CodeField value={String(value)} language={field.language} {clamp} />
{:else if field.type === "json"}
	<JsonField {value} {clamp} />
{:else if field.type === "chat"}
	<ChatField value={value as { role: string; content: string }[]} {clamp} />
{:else if field.type === "image"}
	<ImageField value={String(value)} {clamp} />
{:else if (field.type === "audio" || field.type === "video") && clamp}
	<span class="font-mono text-xs break-all text-gray-500 dark:text-gray-400">
		{String(value).split("/").at(-1)}
	</span>
{:else if field.type === "audio" && imageUrl(String(value))}
	<audio src={imageUrl(String(value))} controls preload="metadata" class="w-full max-w-md"></audio>
{:else if field.type === "video" && imageUrl(String(value))}
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		src={imageUrl(String(value))}
		controls
		preload="metadata"
		class="max-h-96 max-w-full rounded-lg"
	></video>
{:else}
	<span
		class="inline-flex max-w-full items-center rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"
	>
		<span class="truncate">{String(value)}</span>
	</span>
{/if}
