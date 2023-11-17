import { marked } from "marked";
import { IMAGE_DATABASE_CONFIG } from "$env/static/private";

export const executeRequests = async (requests: any[]) => {
	const responses: any[] = [];
	const requestURL = JSON.parse(IMAGE_DATABASE_CONFIG).PROVIDER_URL;

	for (const request of requests) {
		console.log("request", request.body);

		const response = await fetch(`${requestURL}${request.path}`, {
			method: request.method,
			headers: {
				"Content-Type": "application/json",
				accept: "application/json",
			},
			body: JSON.stringify(request.body, null, 4),
		});
		if (response.ok) {
			const data = await response.json().then((data) => data);
			responses.push({ request: requests, data: data });
		} else {
			responses.push({ request: requests, data: "error" });
		}
	}

	return responses;
};
export const processMarkdownToExecuteRequestCodeBlock = async (markdown: string) => {
	const codeBlocks = marked.lexer(markdown).filter((token) => token.type === "code");

	const requests: Request[] = [];

	for (const codeBlock of codeBlocks as any) {
		if (codeBlock.lang !== "{.ecole-request}") continue;
		const codeBlockString = codeBlock.text;

		const request = JSON.parse(codeBlockString) as Request;
		console.log("codeBlockString", codeBlockString);
		requests.push(request);
	}
	console.log("requests", requests);

	const responses = await executeRequests(requests);
	console.log("responses", responses);
	console.log("marked.lexer(markdown)", marked.lexer(markdown));
	const markdownTokens = marked.lexer(markdown).map((token) => {
		if (token.type === "code") {
			if (token.lang === "{.ecole-request}") {
				const response = responses.shift();
				if (response.data !== "error") {
					return `~~~ {.ecole-image}\n ${JSON.stringify(response.data, null, 4)}\n~~~`;
				}
			}
		}
		return token.raw;
	});
	console.log("markdownTokens", markdownTokens);
	return markdownTokens.join("");
};
