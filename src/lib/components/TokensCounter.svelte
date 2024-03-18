<script lang="ts">
	import type { Model } from "$lib/types/Model";
	import { AutoTokenizer } from "@xenova/transformers";

	export let classNames = "";
	export let prompt = "";
	export let model: Model | undefined = undefined;

	let nTokens = 0;
	let isDisabled = false;
	let modelId = model?.id;

	async function tokenizeText() {
		if (isDisabled || !model) {
			return;
		}

		if (!prompt) {
			nTokens = 0;
			return;
		}

		try {
			const tokenizer = await AutoTokenizer.from_pretrained(model.id);
			const { input_ids } = await tokenizer(prompt);
			nTokens = input_ids.size;
			isDisabled = false;
		} catch (err) {
			isDisabled = true;
			console.error("Error while counting tokens: ", err);
		}
	}

	$: {
		if (typeof window !== "undefined" && model) {
			tokenizeText();
		}
	}

	$: {
		if (model?.id !== modelId) {
			// reset
			modelId = model?.id;
			nTokens = 0;
			isDisabled = false;
		}
	}
</script>

{#if !isDisabled && model?.parameters?.max_new_tokens && nTokens}
	<p class="text-sm opacity-60 hover:opacity-80 {classNames}">
		{nTokens}/{model.parameters.max_new_tokens}
	</p>
{/if}
