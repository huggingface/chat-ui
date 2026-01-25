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
	const currentYear = now.getFullYear();
	return [
		`You have access to these tools: ${names.join(", ")}.`,
		`Today's date: ${currentDate}.`,
		`Only use a tool if you cannot answer without it. For simple tasks like writing, editing text, or answering from your knowledge, respond directly without tools.`,
		// Search query formulation guidelines
		`SEARCH QUERY FORMULATION: Write search queries as descriptive statements ending with a colon—this format yields better results than questions. Examples: "Here is the latest SpaceX Starship test flight results:" or "Claude Opus 4.5 benchmark performance comparison:" or "React 19 new features release date:". Use 3-6 precise keywords. Always include the current year (${currentYear}) or "latest"/"recent" for time-sensitive topics. For comparisons or multi-part questions, make separate searches for each part rather than one broad query.`,
		// Critical: How to process and use search results
		`PROCESSING SEARCH RESULTS: Read the ENTIRE search result carefully—important information may appear anywhere, not just at the beginning. Before answering, identify the specific facts from the results that answer the user's question. Use attribution phrases like "According to the search results..." or "The search results indicate..." to ground your response. Only state facts explicitly present in the results—do not add interpretations, characterizations, or inferences beyond what is directly stated. If results conflict, present both perspectives and note the discrepancy. If results are insufficient or don't answer the question, say so clearly (e.g., "The search results don't contain information about X") and consider a follow-up search with refined terms rather than guessing.`,
		// URL handling
		`URLS AND CITATIONS: Never fabricate or generate URLs. Only use URLs that appear verbatim in tool results. If asked for sources, only cite URLs returned by tools.`,
		`If a tool generates an image, you can inline it directly: ![alt text](image_url).`,
		`If a tool needs an image, set its image field ("input_image", "image", or "image_url") to a reference like "image_1", "image_2", etc. (ordered by when the user uploaded them).`,
		`Default to image references; only use a full http(s) URL when the tool description explicitly asks for one, or reuse a URL a previous tool returned.`,
	].join(" ");
}
