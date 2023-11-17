import { ALLOWED_FUNCTIONS, IMAGE_DATABASE_CONFIG } from "$env/static/private";
import { generateFromDefaultEndpoint } from "$lib/server/generateFromDefaultEndpoint";
import { smallModel, type BackendModel } from "$lib/server/models";
import type { Message } from "$lib/types/Message";
import {
	translateFunctionsToFormat,
	type FunctionDescription,
} from "$lib/server/formattingFunctions";
export async function summarize(prompt: string) {
	const messages: Array<Omit<Message, "id">> = [
		{ from: "user", content: "Who is the president of Gabon?" },
		{ from: "assistant", content: "🇬🇦 President of Gabon" },
		{ from: "user", content: "Who is Julien Chaumond?" },
		{ from: "assistant", content: "🧑 Julien Chaumond" },
		{ from: "user", content: "what is 1 + 1?" },
		{ from: "assistant", content: "🔢 Simple math operation" },
		{ from: "user", content: "What are the latest news?" },
		{ from: "assistant", content: "📰 Latest news" },
		{ from: "user", content: "How to make a great cheesecake?" },
		{ from: "assistant", content: "🍰 Cheesecake recipe" },
		{ from: "user", content: "what is your favorite movie? do a short answer." },
		{ from: "assistant", content: "🎥 Favorite movie" },
		{ from: "user", content: "Explain the concept of artificial intelligence in one sentence" },
		{ from: "assistant", content: "🤖 AI definition" },
		{ from: "user", content: "Answer all my questions like chewbacca from now ok?" },
		{ from: "assistant", content: "🐒 Answer as Chewbacca" },
		{ from: "user", content: prompt },
	];

	const summaryPrompt = smallModel.chatPromptRender({
		messages,
		preprompt: `You are a summarization AI. You'll never answer a user's question directly, but instead summarize the user's request into a single short sentence of four words or less. Always start your answer with an emoji relevant to the summary.`,
	});

	return await generateFromDefaultEndpoint(summaryPrompt)
		.then((summary) => {
			// add an emoji if none is found in the first three characters
			if (!/\p{Emoji}/u.test(summary.slice(0, 3))) {
				return "💬 " + summary;
			}
			return summary;
		})
		.catch((e) => {
			console.error(e);
			return null;
		});
}

export function prepromptAccessibleFunction(model: BackendModel) {
	// ${translateFunctionsToFormat(JSON.parse(String(ALLOWED_FUNCTIONS) ))}
	console.log("ALLOWED_FUNCTIONS:", ALLOWED_FUNCTIONS);
	let functions: Array<FunctionDescription> = [];
	try {
		functions = JSON.parse(ALLOWED_FUNCTIONS);
		console.log("parsed function");
	} catch (e) {
		console.log("error in parsing JSON: \n", e);
	}
	const preprompt = `You are a helpful assistant assigned with the task of problem-solving. To achieve this, you will be using an interactive API calling environment equipped with a variety of tool functions to assist you throughout the process.
	At each turn, you should first provide your step-by-step thinking for solving the task. After that, you have two options:
	1) Interact with a fenced code block and receive the corresponding output. Your code should be enclosed using the fenced code block  with language "ecole-request", and the wrapper function. Fenced code blocks begin with three or more tildes (~~~) on a line by themselves and end with a matching set of backticks or tildes on a line by themselves. The closing set must contain the same number and type of characters as the opening set. For example, if you want to use the API call to segment an image, you should use the following format:
	~~~ {.ecole-request} 
	{
		"method": "POST",
		"path": "/segment",
		"body": {
			"image_id": "example_image_id",
			"prompt": "Prompt 4"
		}
	}
	~~~

2) Directly provide a solution that adheres to the required format for the given task. Your solution should be enclosed using the fenced code block with language "ecole-image", for example: 
The answer is :
~~~ {.ecole-image}
{
	"id": "1",
	"url": "http://127.0.0.1/get/1"
}
~~~ 

	You only need to use the API calls if you have to, if you already know the solution just give the solution.\n Tool function available (already imported in fenced code block environment): \n
	
	${translateFunctionsToFormat(functions)}
	`;
	console.log("preprompt function", preprompt);
	return preprompt;
}
export async function getImagesFromDatabase() {
	const config = JSON.parse(String(IMAGE_DATABASE_CONFIG));
	console.log("config ", config);
	const url = config.PROVIDER_URL;
	console.log("url ", url);
	const data = await fetch(url + "/original_images_list", {
		method: "GET",
		headers: {
			"Content-Type": "application/json",
		},
	})
		.then((response) => {
			console.log("response ", response);
			return response.json();
		})
		.catch((e) => {
			console.log("error ", e);
			return [];
		});
	if (data instanceof Array) {
		return String(JSON.stringify(data, null, 4));
	}
	return String(data) ?? [];
}
export async function prepromptImageDatabase(model: BackendModel) {
	const imageList = await getImagesFromDatabase();
	const preprompt = `\n\n You are to use only the existing image IDs from the provided list in our hypothetical image database. The database contains specific image IDs and their corresponding URLs as follows: \n
	${imageList}
	
	When responding to a request for an image, ensure that you select only from the existing IDs in the provided list. Format your response in a fenced code block with language "ecole-image" like this: \n 
	~~~ {.ecole-image}
	{
		"id": "existing_id",
		"url": "corresponding_url"
	}
	~~~
	For instance, if the list includes an image with id = "1" and its url is "http://127.0.0.1/get/1", your response should be:
	~~~ {.ecole-image}
	{
		"id": "1",
		"url": "http://127.0.0.1/get/1"
	}
	~~~
	
	Please do not create or infer any image IDs or URLs that are not explicitly listed in the provided image database.
	`;
	console.log("preprompt image", preprompt);
	return preprompt;
}
