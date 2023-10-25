import type { BackendModel } from "./server/models";
import type { Message } from "./types/Message";
import { format } from "date-fns";
import type { WebSearch } from "./types/WebSearch";

interface buildPromptOptions {
	messages: Pick<Message, "from" | "content" | "files">[];
	model: BackendModel;
	locals?: App.Locals;
	webSearch?: WebSearch;
	preprompt?: string;
	files?: File[];
	url?: URL;
	fetch?: typeof fetch;
}

export async function buildPrompt({
	messages,
	model,
	webSearch,
	preprompt,
	url,
	fetch,
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

	if (model.multimodal) {
		messages = await Promise.all(
			messages.map(async (el) => {
				let content = el.content;

				if (el.from === "user") {
					// append each files ![](data:image/png;base64,<base64content here>) to the end of the message
					// the content of the file is fetched from `conversation/[id]/output/[file] and then needs to be base64 encoded
					if (el.files && url && fetch && el.files?.length > 0) {
						const markdowns = await Promise.all(
							el.files.map(async (hash) => {
								try {
									const blob = await fetch(`${url.href}/output/${hash}`).then((res) => res.text());
									const file = new File([blob], "image.png");
									const b64 = await file
										.text()
										.then((text) => Buffer.from(text).toString("base64"));

									return `\n ![](data:image/png;base64,${b64})})`;
								} catch (e) {
									console.error(e);
								}
							})
						);
						content += markdowns.join(" ");
					} else {
						content +=
							"\n![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEYAAAAUCAAAAAAVAxSkAAABrUlEQVQ4y+3TPUvDQBgH8OdDOGa+oUMgk2MpdHIIgpSUiqC0OKirgxYX8QVFRQRpBRF8KShqLbgIYkUEteCgFVuqUEVxEIkvJFhae3m8S2KbSkcFBw9yHP88+eXucgH8kQZ/jSm4VDaIy9RKCpKac9NKgU4uEJNwhHhK3qvPBVO8rxRWmFXPF+NSM1KVMbwriAMwhDgVcrxeMZm85GR0PhvGJAAmyozJsbsxgNEir4iEjIK0SYqGd8sOR3rJAGN2BCEkOxhxMhpd8Mk0CXtZacxi1hr20mI/rzgnxayoidevcGuHXTC/q6QuYSMt1jC+gBIiMg12v2vb5NlklChiWnhmFZpwvxDGzuUzV8kOg+N8UUvNBp64vy9q3UN7gDXhwWLY2nMC3zRDibfsY7wjEkY79CdMZhrxSqqzxf4ZRPXwzWJirMicDa5KwiPeARygHXKNMQHEy3rMopDR20XNZGbJzUtrwDC/KshlLDWyqdmhxZzCsdYmf2fWZPoxCEDyfIvdtNQH0PRkH6Q51g8rFO3Qzxh2LbItcDCOpmuOsV7ntNaERe3v/lP/zO8yn4N+yNPrekmPAAAAAElFTkSuQmCC)";
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
