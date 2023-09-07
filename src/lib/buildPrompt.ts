import type { BackendModel } from "./server/models";
import type { Message } from "./types/Message";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
/**
 * Convert [{user: "assistant", content: "hi"}, {user: "user", content: "hello"}] to:
 *
 * <|assistant|>hi<|endoftext|><|prompter|>hello<|endoftext|><|assistant|>
 */



async function makePostRequest(query: string): Promise<string> {
	try {
	  const response = await fetch('http://host.docker.internal:3040/get_prompt', {
		method: 'POST',
		headers: {
		  'Content-Type': 'application/json',
		},
		body: JSON.stringify({ query: query }),
	  });
  
	  if (response.ok) {
		const data = await response.json();
		console.log(data);
		return data.context;
	  } else {
		return "";
		
	  }
	} catch (error) {
	  console.error(error);
	  return "";
	}
  }

export async function buildPrompt(
	messages: Pick<Message, "from" | "content">[],
	model: BackendModel,
	webSearchId?: string
): Promise<string> {
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

	let webPrompt = "";


	// if (webSearchId) {
	// 	const webSearch = await collections.webSearches.findOne({
	// 		_id: new ObjectId(webSearchId),
	// 	});

	// 	if (!webSearch) throw new Error("Web search not found");


	// 	if (webSearch.summary) {
	// 		webPrompt =
	// 			model.assistantMessageToken +
	// 			`The following context was found while searching the internet: ${webSearch.summary}` +
	// 			model.messageEndToken;
	// 	}
	// }

	// Integrate the preprompt
	console.log("making request!");
	const context = await makePostRequest(prompt);

		
	// webPrompt =
	// model.assistantMessageToken +
	// `The following context was found while searching the internet: [${context}]` +
	// model.messageEndToken;


			
	webPrompt =`The following context is relevant to the Human question : [${context}]`;


		
	const finalPrompt =
		model.preprompt +
		webPrompt +
		prompt
			.split(" ")
			.slice(-(model.parameters?.truncate ?? 0))
			.join(" ");

	// Not super precise, but it's truncated in the model's backend anyway
	return finalPrompt;
}
