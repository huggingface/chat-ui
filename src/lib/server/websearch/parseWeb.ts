import Parser from "@postlight/parser";

interface ParserResult {
	title: string | null;
	content: string | null;
	author: string | null;
	date_published: string | null;
	lead_image_url: string | null;
	url: string;
	error?: boolean;
	message?: string;
}

export async function parseWeb(url: string) {
	const abortController = new AbortController();
	setTimeout(() => abortController.abort(), 10000);
	const result = (await Parser.parse(url, { contentType: "text" })) as ParserResult;
	if (result.error) {
		throw new Error(result.message);
	}

	let { content } = result;
	// remove newlines and multiple spaces
	content = content?.replace(/ {2}|\r\n|\n|\r/gm, "") ?? null;
	if (!content) {
		throw new Error(`parser couldn't find any text content`);
	}
	return content;
}
