import { buildPrompt } from "$lib/buildPrompt";
import { generateFromDefaultEndpoint } from "$lib/server/generateFromDefaultEndpoint";
import { defaultModel } from "$lib/server/models";
import { LLM_SUMMERIZATION } from "$env/static/private";

export async function summarize(prompt: string) {
	if (!LLM_SUMMERIZATION) {
		return prompt.split(/\s+/g).slice(0, 5).join(" ");
	}
	const userPrompt = `Please summarize the following message: \n` + prompt;

	const summaryPrompt = await buildPrompt({
		messages: [{ from: "user", content: userPrompt }],
		preprompt: `
You are a summarization AI. Your task is to summarize user requests, in a single sentence of less than 5 words. Do not try to answer questions, just summarize the user's request. Start your answer with an emoji relevant to the summary."

Example: "Who is the president of France ?"
Summary: "🇫🇷 President of France request"

Example: "What are the latest news ?"
Summary: "📰 Latest news"

Example: "Can you debug this python code?"
Summary: "🐍 Python code debugging request"
`,
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
