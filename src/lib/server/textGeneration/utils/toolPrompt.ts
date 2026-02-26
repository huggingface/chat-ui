import type { OpenAiTool } from "$lib/server/mcp/tools";

export function buildToolPreprompt(tools: OpenAiTool[]): string {
	if (!Array.isArray(tools) || tools.length === 0) return "";
	const names = tools
		.map((t) => (t?.function?.name ? String(t.function.name) : ""))
		.filter((s) => s.length > 0);
	if (names.length === 0) return "";
	const now = new Date();
	const currentDate = now.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
	const isoDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	return [
		`You have access to these tools: ${names.join(", ")}.`,
		`Today's date: ${currentDate} (${isoDate}).`,
		``,
		`IMPORTANT: Do NOT use tools for tasks you can handle directly. You MUST respond without calling any tool for:`,
		`- Writing, generating, or editing code (HTML, CSS, JavaScript, Python, etc.)`,
		`- Creative writing, storytelling, text editing, summarization, or translation`,
		`- Math, logic, and reasoning problems`,
		`- Explaining concepts or answering from your training knowledge`,
		`- Building interactive apps, games, or visualizations`,
		`Only use a tool when the user's request REQUIRES external data you do not have, such as current news, real-time information, specific website content, or live data lookups. When in doubt, respond directly without tools.`,
		``,
		`PARALLEL TOOL CALLS: When multiple tool calls are needed and they are independent of each other (i.e., one does not need the result of another), call them all at once in a single response instead of one at a time. Only chain tool calls sequentially when a later call depends on an earlier call's output.`,
		``,
		`SEARCH: Use 3-6 precise keywords. For historical events, include the year the event occurred. For recent or current topics, use today's year (${now.getFullYear()}). When a tool accepts date-range parameters (e.g., startPublishedDate, endPublishedDate), always use today's date (${isoDate}) as the end date unless the user specifies otherwise. For multi-part questions, search each part separately.`,
		``,
		`ANSWER: State only facts explicitly in the results. If info is missing or results conflict, say so. Never fabricate URLs or facts.`,
		``,
		`INTERACTIVE APPS: When asked to build an interactive application, game, or visualization without a specific language/framework preference, create a single self-contained HTML file with embedded CSS and JavaScript.`,
		``,
		`IMAGES: If a tool generates an image, you can inline it directly: ![alt text](image_url). If a tool needs an image, set its image field ("input_image", "image", or "image_url") to a reference like "image_1", "image_2", etc. (ordered by when the user uploaded them). Default to image references; only use a full http(s) URL when the tool description explicitly asks for one, or reuse a URL a previous tool returned.`,
	].join("\n");
}
