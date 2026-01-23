import type { OpenAiTool } from "$lib/server/mcp/tools";

export function buildToolPreprompt(tools: OpenAiTool[]): string {
	if (!Array.isArray(tools) || tools.length === 0) return "";
	const names = tools
		.map((t) => (t?.function?.name ? String(t.function.name) : ""))
		.filter((s) => s.length > 0);
	if (names.length === 0) return "";
	const currentDate = new Date().toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
	return [
		`You have access to these tools: ${names.join(", ")}.`,
		`Today's date: ${currentDate}.`,
		`Only use a tool if you cannot answer without it. For simple tasks like writing, editing text, or answering from your knowledge, respond directly without tools.`,
		`For search queries: use few precise keywords (3-6 words), avoid redundant synonyms, use the exact terminology the source would use, prefer relative time terms like "latest" or "newest" over specific years.`,
		`When using search tools: carefully read ALL results before answering. Only state facts explicitly found in the search results—do not assume, infer, or hallucinate information not present. If results conflict, acknowledge the discrepancy. Cite your sources when possible.`,
		`If a tool generates an image, you can inline it directly: ![alt text](image_url).`,
		`If a tool needs an image, set its image field ("input_image", "image", or "image_url") to a reference like "image_1", "image_2", etc. (ordered by when the user uploaded them).`,
		`Default to image references; only use a full http(s) URL when the tool description explicitly asks for one, or reuse a URL a previous tool returned.`,
	].join(" ");
}
