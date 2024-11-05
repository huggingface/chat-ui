import type { Model } from "$lib/types/Model";
import { AutoTokenizer, PreTrainedTokenizer } from "@xenova/transformers";

export async function getTokenizer(_modelTokenizer: Exclude<Model["tokenizer"], undefined>) {
	if (typeof _modelTokenizer === "string") {
		// return auto tokenizer
		return await AutoTokenizer.from_pretrained(_modelTokenizer);
	} else {
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
