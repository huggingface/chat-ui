import { generateFromDefaultEndpoint } from "../generateFromDefaultEndpoint";
import type { BackendModel } from "../models";

export async function summarizeWeb(content: string, query: string, model: BackendModel) {
	const summaryPrompt =
		model.userMessageToken +
		content
			.split(" ")
			.slice(0, model.parameters?.truncate ?? 0)
			.join(" ") +
		model.messageEndToken +
		model.userMessageToken +
		`The text above should be summarized to best answer the query: ${query}.` +
		model.messageEndToken +
		model.assistantMessageToken +
		"Summary: ";

	const summary = await generateFromDefaultEndpoint(summaryPrompt).then((txt: string) =>
		txt.trim()
	);

	return summary;
}
