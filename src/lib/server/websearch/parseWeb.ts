import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";

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

		const article = new Readability(document).parse();

		return article?.textContent ?? "";
	} else if (
		r.headers.get("content-type")?.includes("text/plain") ||
		r.headers.get("content-type")?.includes("text/markdown")
	) {
		return r.text();
	} else {
		throw new Error("Unsupported content type");
	}
}
