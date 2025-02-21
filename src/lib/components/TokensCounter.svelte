<script lang="ts">
	import type { Model } from "$lib/types/Model";
	import { getTokenizer } from "$lib/utils/getTokenizer";
	import type { PreTrainedTokenizer } from "@huggingface/transformers";
	import { untrack } from "svelte";

	interface Props {
		classNames?: string;
		prompt?: string;
		modelTokenizer: Exclude<Model["tokenizer"], undefined>;
		truncate?: number | undefined;
	}

	let { classNames = "", prompt = "", modelTokenizer, truncate = undefined }: Props = $props();

	let tokenizer: Promise<PreTrainedTokenizer> = $derived(getTokenizer(modelTokenizer));

	let nTokens = $state(0);

	$effect(() => {
		prompt &&
			untrack(() => {
				tokenizer.then((tokenizer) => {
					const { input_ids } = tokenizer(prompt);
					nTokens = input_ids.size;
				});
			});
	});

	let exceedLimit = $derived(nTokens > (truncate || Infinity));
</script>

<div class={classNames}>
	<p
		class="peer text-sm {exceedLimit ? 'text-red-500 opacity-100' : 'opacity-60 hover:opacity-90'}"
	>
		{nTokens}{truncate ? `/${truncate}` : ""}
	</p>
	<div
		class="invisible absolute -top-6 right-0 whitespace-nowrap rounded bg-black px-1 text-sm text-white peer-hover:visible"
	>
		Tokens usage
	</div>
</div>
