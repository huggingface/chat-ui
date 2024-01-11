import { JSDOM, VirtualConsole } from "jsdom";

export async function searchWebLocal(query: string) {
	const abortController = new AbortController();
	setTimeout(() => abortController.abort(), 10000);

	const htmlString = await fetch("https://www.google.com/search?hl=en&q=" + query, {
		signal: abortController.signal,
	})
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
	// get all a documents with href tag

	const links = document.querySelectorAll("a");

	if (!links.length) {
		throw new Error(`webpage doesn't have any "a" element`);
	}

	// take url that start wirth /url?q=
	// and do not contain google.com links
	// and strip them up to '&sa='
	const linksHref = Array.from(links)
		.filter((el) => el.href?.startsWith("/url?q=") && !el.href.includes("google.com/"))
		.map((el) => {
			const link = el.href;
			return link.slice("/url?q=".length, link.indexOf("&sa="));
		});

	// remove duplicate links and map links to the correct object shape
	return { organic_results: [...new Set(linksHref)].map((link) => ({ link })) };
}
