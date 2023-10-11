import { LLM_SUMMERIZATION } from "$env/static/private";
import { generateFromDefaultEndpoint } from "$lib/server/generateFromDefaultEndpoint";
import { smallModel } from "$lib/server/models";
import type { Message } from "$lib/types/Message";

export async function summarize(prompt: string) {
	if (!LLM_SUMMERIZATION) {
		return prompt.split(/\s+/g).slice(0, 5).join(" ");
	}

	const messages: Array<Omit<Message, "id">> = [
		{ from: "user", content: "Who is the president of France ?" },
		{ from: "assistant", content: "🇫🇷 President of France request" },
		{ from: "user", content: "What are the latest news ?" },
		{ from: "assistant", content: "📰 Latest news" },
		{ from: "user", content: "Can you debug this python code?" },
		{ from: "assistant", content: "🐍 Python code debugging request" },
		{ from: "user", content: prompt },
	];

	const summaryPrompt = smallModel.chatPromptRender({
		messages,
		preprompt: `You are a summarization AI. Your task is to summarize user requests, in a single sentence of less than 5 words. Do not try to answer questions, just summarize the user's request. Start your answer with an emoji relevant to the summary.`,
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
