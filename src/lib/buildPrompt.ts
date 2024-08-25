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
			messages: filteredMessages,
			preprompt,
			tools,
			toolResults,
		})
		// Not super precise, but it's truncated in the model's backend anyway
		.split(" ")
		.slice(-(model.parameters?.truncate ?? 0))
		.join(" ");

	if (continueMessage && model.parameters?.stop) {
		prompt = model.parameters.stop.reduce((acc: string, curr: string) => {
			if (acc.endsWith(curr)) {
				return acc.slice(0, acc.length - curr.length);
			}
			return acc;
		}, prompt.trimEnd());
	}

	return prompt;
}
