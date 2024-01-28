import type { BackendModel } from "./server/models";
import type { Message } from "./types/Message";
import { downloadImgFile } from "./server/files/downloadFile";
import type { Conversation } from "./types/Conversation";
import RAGs from "./server/rag/rag";
import type { RagContext } from "./types/rag";
import type { RagContextWebSearch } from "./types/WebSearch";

export type BuildPromptMessage = Pick<Message, "from" | "content" | "files">;

interface buildPromptOptions {
	messages: BuildPromptMessage[];
	id?: Conversation["_id"];
	model: BackendModel;
	locals?: App.Locals;
	ragContexts?: {
		webSearch?: RagContextWebSearch;
		pdfChat?: RagContext;
		// Add more context types as needed
	};
	preprompt?: string;
	files?: File[];
}

export async function buildPrompt({
	messages,
	model,
	ragContexts,
	preprompt,
	id,
}: buildPromptOptions): Promise<string> {
	if (ragContexts) {
		for (const [ragKey, ragContext] of Object.entries(ragContexts)) {
			if (ragKey == "webSearch" && ragContext) {
				messages = RAGs.webSearch.buildPrompt(messages, ragContext as RagContextWebSearch);
			}
			if (ragKey == "pdfChat" && ragContext) {
				messages = RAGs.pdfChat.buildPrompt(messages, ragContext as RagContext);
			}
		}
	}

	// section to handle potential files input
	if (model.multimodal) {
		messages = await Promise.all(
			messages.map(async (el) => {
				let content = el.content;

				if (el.from === "user") {
					if (el?.files && el.files.length > 0 && id) {
						const markdowns = await Promise.all(
							el.files.map(async (hash) => {
								try {
									const { content: image, mime } = await downloadImgFile(hash, id);
									const b64 = image.toString("base64");
									return `![](data:${mime};base64,${b64})})`;
								} catch (e) {
									console.error(e);
								}
							})
						);
						content += markdowns.join("\n ");
					} else {
						// if no image, append an empty white image
						content +=
							"\n![](data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAAQABADAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD+/igAoAKACgD/2Q==)";
					}
				}

				return { ...el, content };
			})
		);
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
