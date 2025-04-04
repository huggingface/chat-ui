import type { EndpointParameters } from "./server/endpoints/endpoints";
import type { BackendModel } from "./server/models";
import type { Tool, ToolResult } from "./types/Tool";

type buildPromptOptions = Pick<EndpointParameters, "messages" | "preprompt" | "continueMessage"> & {
	model: BackendModel;
	tools?: Tool[];
	toolResults?: ToolResult[];
};

export async function buildPrompt({
	messages,
	model,
	preprompt,
	continueMessage,
	tools,
	toolResults,
}: buildPromptOptions): Promise<string> {
	const filteredMessages = messages;

	if (filteredMessages[0].from === "system" && preprompt) {
		filteredMessages[0].content = preprompt;
	}

	let prompt = model
		.chatPromptRender({
			messages: filteredMessages.map((m) => ({
				...m,
				role: m.from,
			})),
			preprompt,
			tools,
			toolResults,
			continueMessage,
		})
		// Not super precise, but it's truncated in the model's backend anyway
		.split(" ")
		.slice(-(model.parameters?.truncate ?? 0))
		.join(" ");

	if (continueMessage && model.parameters?.stop) {
		let trimmedPrompt = prompt.trimEnd();
		let hasRemovedStop = true;
		while (hasRemovedStop) {
			hasRemovedStop = false;
			for (const stopToken of model.parameters.stop) {
				if (trimmedPrompt.endsWith(stopToken)) {
					trimmedPrompt = trimmedPrompt.slice(0, -stopToken.length);
					hasRemovedStop = true;
					break;
				}
			}
			trimmedPrompt = trimmedPrompt.trimEnd();
		}
		prompt = trimmedPrompt;
	}

	return prompt;
}
