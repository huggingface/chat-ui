import {
	PUBLIC_ASSISTANT_MESSAGE_TOKEN,
	PUBLIC_SEP_TOKEN,
	PUBLIC_USER_MESSAGE_TOKEN
} from '$env/static/public';
import type { Message } from './types/Message';

/**
 * Convert [{user: "assistant", content: "hi"}, {user: "user", content: "hello"}] to:
 *
 * <|assistant|>hi<|endoftext|><|prompter|>hello<|endoftext|><|assistant|>
 */
export function buildPrompt(messages: Message[]): string {
	return (
		messages
			.map(
				(m) =>
					(m.from === 'user'
						? PUBLIC_USER_MESSAGE_TOKEN + m.content
						: PUBLIC_ASSISTANT_MESSAGE_TOKEN + m.content) +
					(m.content.endsWith(PUBLIC_SEP_TOKEN) ? '' : PUBLIC_SEP_TOKEN)
			)
			.join('') + PUBLIC_ASSISTANT_MESSAGE_TOKEN
	);
}
