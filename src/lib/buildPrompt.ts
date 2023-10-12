import type { BackendModel } from "./server/models";
import type { Message } from "./types/Message";
import { format } from "date-fns";
import type { WebSearch } from "./types/WebSearch";
/**
 * Convert [{user: "assistant", content: "hi"}, {user: "user", content: "hello"}] to:
 *
 * <|assistant|>hi<|endoftext|><|prompter|>hello<|endoftext|><|assistant|>
 */

interface buildPromptOptions {
	messages: Pick<Message, "from" | "content">[];
	model: BackendModel;
	locals?: App.Locals;
	webSearch?: WebSearch;
	preprompt?: string;
}

export async function buildPrompt({
	messages,
	model,
	webSearch,
	preprompt,
}: buildPromptOptions): Promise<string> {
	if (webSearch && webSearch.context) {
		const lastMsg = messages.slice(-1)[0];
		const messagesWithoutLastUsrMsg = messages.slice(0, -1);
		const previousUserMessages = messages.filter((el) => el.from === "user").slice(0, -1);

		const previousQuestions =
			previousUserMessages.length > 0
				? `Previous questions: \n${previousUserMessages
						.map(({ content }) => `- ${content}`)
						.join("\n")}`
				: "";
		const currentDate = format(new Date(), "MMMM d, yyyy");
		messages = [
			...messagesWithoutLastUsrMsg,
			{
				from: "user",
				content: `I searched the web using the query: ${webSearch.searchQuery}. Today is ${currentDate} and here are the results:
				=====================
				${webSearch.context}
				=====================
				${previousQuestions}
				Answer the question: ${lastMsg.content} 
				`,
			},
		];
	}

	return (
		model
			.chatPromptRender({ messages, preprompt })
			// Not super precise, but it's truncated in the model's backend anyway
			.split(" ")
			.slice(-(model.parameters?.truncate ?? 0))
			.join(" ")
	);
}
