import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";
import { format } from "date-fns";
import { downloadFile } from "./files/downloadFile";
import { logger } from "$lib/server/logger";

export async function preprocessMessages(
	messages: Message[],
	webSearch: Message["webSearch"],
	multimodal: boolean,
	id: Conversation["_id"]
): Promise<Message[]> {
	return await Promise.all(
		structuredClone(messages).map(async (message, idx) => {
			const webSearchContext = webSearch?.contextSources
				.map(({ context }, citationIdx) => `[[${citationIdx + 1}]]: ${context.trim()}`)
				.join("\n\n----------\n\n");

			// start by adding websearch to the last message
			if (idx === messages.length - 1 && webSearch && webSearchContext?.trim()) {
				const lastQuestion = messages.findLast((el) => el.from === "user")?.content ?? "";
				const previousQuestions = messages
					.filter((el) => el.from === "user")
					.slice(0, -1)
					.map((el) => el.content);
				const currentDate = format(new Date(), "MMMM d, yyyy");

				message.content = `I searched the web using the query: ${webSearch.searchQuery}
Please format your response to include inline citation numbers like [[1]], [[2]], etc. whenever referencing information from an external source. Place these inline citations at the end of the relevant sentence or paragraph. Do not include a list of sources or references at the end of your response.
Today is ${currentDate} and here is a list of sources:
=====================
${webSearchContext}
=====================
${previousQuestions.length > 0 ? `Previous questions: \n- ${previousQuestions.join("\n- ")}` : ""}
Answer the question: ${lastQuestion}`;
			}
			// handle files if model is multimodal
			if (multimodal) {
				if (message.files && message.files.length > 0) {
					const markdowns = await Promise.all(
						message.files.map(async (hash) => {
							try {
								const { content: image, mime } = await downloadFile(hash, id);
								const b64 = image.toString("base64");
								return `![](data:${mime};base64,${b64})})`;
							} catch (e) {
								logger.error(e);
							}
						})
					);
					message.content += markdowns.join("\n ");
				} else {
					// if no image, append an empty white image
					message.content +=
						"\n![](data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAAQABADAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD+/igAoAKACgD/2Q==)";
				}
			}

			return message;
		})
	);
}
