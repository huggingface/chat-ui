import { JSDOM, VirtualConsole } from "jsdom";

export async function parseWeb(url: string) {
	const abortController = new AbortController();
	setTimeout(() => abortController.abort(), 10000);
	const r = await fetch(url, { signal: abortController.signal, credentials: "omit" }).catch();

	if (r.headers.get("content-type")?.includes("text/html")) {
		const virtualConsole = new VirtualConsole();
		virtualConsole.on("error", () => {
			// No-op to skip console errors.
		});

		// put the html string into a DOM
		const dom = new JSDOM((await r.text()) ?? "", {
			virtualConsole,
		});

		const { document } = dom.window;
		const paragraphs = document.querySelectorAll("p, table, pre, ul, ol");

		if (!paragraphs.length) {
			throw new Error(`webpage doesn't have any parseable element`);
		}
		const paragraphTexts = Array.from(paragraphs).map((p) => p.textContent);

		// combine text contents from paragraphs and then remove newlines and multiple spaces
		const text = paragraphTexts.join(" ").replace(/ {2}|\r\n|\n|\r/gm, "");

		return text;
	} else if (
		r.headers.get("content-type")?.includes("text/plain") ||
		r.headers.get("content-type")?.includes("text/markdown")
	) {
		return r.text();
	} else {
		throw new Error("Unsupported content type");
	}
}
