import { buildPrompt } from "$lib/buildPrompt";
import { generateFromDefaultEndpoint } from "$lib/server/generateFromDefaultEndpoint";
import { defaultModel } from "$lib/server/models";

export async function summarize(prompt: string) {
	const userPrompt = `Please summarize the following message: \n` + prompt;

	const summaryPrompt = await buildPrompt({
		messages: [{ from: "user", content: userPrompt }],
		preprompt:
			"You are a summarization AI. Your task is to summarize user requests, in a single sentence of less than 5 words. Do not try to answer questions, just summarize the user's request.",
		model: defaultModel,
	});

	const generated_text = await generateFromDefaultEndpoint(summaryPrompt).catch((e) => {
		console.error(e);
		return null;
	});

	if (generated_text) {
		return generated_text;
	}

	return null;
}
