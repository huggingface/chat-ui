import { JSDOM, VirtualConsole } from "jsdom";

function removeTags(node: Node) {
	if (node.hasChildNodes()) {
		node.childNodes.forEach((childNode) => {
			if (node.nodeName === "SCRIPT" || node.nodeName === "STYLE") {
				node.removeChild(childNode);
			} else {
				removeTags(childNode);
			}
		});
	}
}
function naiveInnerText(node: Node): string {
	const Node = node; // We need Node(DOM's Node) for the constants, but Node doesn't exist in the nodejs global space, and any Node instance references the constants through the prototype chain
	return [...node.childNodes]
		.map((childNode) => {
			switch (childNode.nodeType) {
				case Node.TEXT_NODE:
					return node.textContent;
				case Node.ELEMENT_NODE:
					return naiveInnerText(childNode);
				default:
					return "";
			}
		})
		.join("\n");
}

export async function parseWeb(url: string) {
	const abortController = new AbortController();
	setTimeout(() => abortController.abort(), 10000);
	const htmlString = await fetch(url, { signal: abortController.signal })
		.then((response) => response.text())
		.catch((err) => console.log(err));

	const virtualConsole = new VirtualConsole();
	virtualConsole.on("error", () => {
		// No-op to skip console errors.
	});

	// put the html string into a DOM
	const dom = new JSDOM(htmlString ?? "", {
		virtualConsole,
	});

	const body = dom.window.document.querySelector("body");
	if (!body) throw new Error("body of the webpage is null");

	removeTags(body);

	// recursively extract text content from the body and then remove newlines and multiple spaces
	const text = (naiveInnerText(body) ?? "").replace(/ {2}|\r\n|\n|\r/gm, "");

	return text;
}
