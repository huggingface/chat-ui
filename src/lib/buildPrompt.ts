import type { BackendModel } from "./server/models";
import type { Message } from "./types/Message";

/**
 * Convert [{user: "assistant", content: "hi"}, {user: "user", content: "hello"}] to:
 *
 * <|assistant|>hi<|endoftext|><|prompter|>hello<|endoftext|><|assistant|>
 */
export function buildPrompt(
	messages: Pick<Message, "from" | "content">[],
	model: BackendModel
): string {
	const prompt =
		messages
			.map(
				(m) =>
					(m.from === "user"
						? model.userMessageToken + m.content
						: model.assistantMessageToken + m.content) +
					(model.messageEndToken
						? m.content.endsWith(model.messageEndToken)
							? ""
							: model.messageEndToken
						: "")
			)
			.join("") + model.assistantMessageToken;

	// Not super precise, but it's truncated in the model's backend anyway
	return model.preprompt + prompt.split(" ").slice(-model.parameters.truncate).join(" ");
}
