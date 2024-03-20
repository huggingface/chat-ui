<script lang="ts">
	import type { Model } from "$lib/types/Model";
	import { AutoTokenizer, PreTrainedTokenizer } from "@xenova/transformers";

	export let classNames = "";
	export let prompt = "";
	export let modelTokenizer: Exclude<Model["tokenizer"], undefined>;
	export let truncate: number | undefined = undefined;

	let tokenizer: PreTrainedTokenizer | undefined = undefined;

	async function getTokenizer(_modelTokenizer: Exclude<Model["tokenizer"], undefined>) {
		if (typeof _modelTokenizer === "string") {
			// return auto tokenizer
			return await AutoTokenizer.from_pretrained(_modelTokenizer);
		}
		{
			// construct & return pretrained tokenizer
			const { tokenizerUrl, tokenizerConfigUrl } = _modelTokenizer satisfies {
				tokenizerUrl: string;
				tokenizerConfigUrl: string;
			};
			const tokenizerJSON = await (await fetch(tokenizerUrl)).json();
			const tokenizerConfig = await (await fetch(tokenizerConfigUrl)).json();
			return new PreTrainedTokenizer(tokenizerJSON, tokenizerConfig);
		}
	}

	async function tokenizeText(_prompt: string) {
		if (!tokenizer) {
			return;
		}
		const { input_ids } = await tokenizer(_prompt);
		return input_ids.size;
	}

	$: (async () => {
		tokenizer = await getTokenizer(modelTokenizer);
	})();
</script>

{#if tokenizer}
	{#await tokenizeText(prompt) then nTokens}
		<p class="text-sm opacity-60 hover:opacity-80 {classNames}">
			{nTokens}{truncate ? `/${truncate}` : ""}
		</p>
	{/await}
{/if}
