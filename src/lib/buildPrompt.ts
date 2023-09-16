import type { BackendModel } from "./server/models";
import type { Message } from "./types/Message";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { authCondition } from "./server/auth";
import { format } from "date-fns";
/**
 * Convert [{user: "assistant", content: "hi"}, {user: "user", content: "hello"}] to:
 *
 * <|assistant|>hi<|endoftext|><|prompter|>hello<|endoftext|><|assistant|>
 */

interface buildPromptOptions {
	messages: Pick<Message, "from" | "content">[];
	model: BackendModel;
	locals?: App.Locals;
	webSearchId?: string;
	preprompt?: string;
}

export async function buildPrompt({
	messages,
	model,
	locals,
	webSearchId,
	preprompt,
}: buildPromptOptions): Promise<string> {
	if (webSearchId) {
		const webSearch = await collections.webSearches.findOne({
			_id: new ObjectId(webSearchId),
		});

		if (!webSearch) throw new Error("Web search not found");
		if (!locals) throw new Error("User not authenticated");

		const conversation = await collections.conversations.findOne({
			_id: webSearch.convId,
			...authCondition(locals),
		});

		if (!conversation) throw new Error("Conversation not found");

		if (webSearch.context) {
			const messagesWithoutLastUsrMsg = messages.slice(0, -1);
			const lastUserMsg = messages.slice(-1)[0];
			const currentDate = format(new Date(), "MMMM d, yyyy");
			messages = [
				...messagesWithoutLastUsrMsg,
				{
					from: "user",
					content: `Please answer my question "${lastUserMsg.content}" using the supplied context below (paragrpahs from various websites). For the context, today is ${currentDate}: \n=====================\n${webSearch.context}\n=====================\nSo my question is "${lastUserMsg.content}"`,
				},
			];
		}
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
