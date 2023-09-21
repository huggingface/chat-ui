import { JSDOM, VirtualConsole } from "jsdom";

export async function parseWeb(url: string) {
	const abortController = new AbortController();
	setTimeout(() => abortController.abort(), 10000);
	const htmlString = await fetch(url, { signal: abortController.signal })
		.then((response) => response.text())
		.catch();

	const virtualConsole = new VirtualConsole();
	virtualConsole.on("error", () => {
		// No-op to skip console errors.
	});

	// put the html string into a DOM
	const dom = new JSDOM(htmlString ?? "", {
		virtualConsole,
	});

	const { document } = dom.window;
	const textElTags = "p";
	const paragraphs = document.querySelectorAll(textElTags);
	if (!paragraphs.length) {
		throw new Error(`webpage doesn't have any "${textElTags}" element`);
	}
	const paragraphTexts = Array.from(paragraphs).map((p) => p.textContent);

	// combine text contents from paragraphs and then remove newlines and multiple spaces
	const text = paragraphTexts.join(" ").replace(/ {2}|\r\n|\n|\r/gm, "");

	return text;
}
