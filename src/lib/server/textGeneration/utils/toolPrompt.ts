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
		`IMPORTANT: Do NOT call a tool unless the user's request requires external or real-time data you do not have. If you can answer from your own knowledge, do so directly without tools. When in doubt, do not use a tool.`,
		``,
		`When you do use tools: make independent calls in parallel. For search, use 3-6 precise keywords; include the year for dated topics (use ${now.getFullYear()} for current topics). When a tool accepts date-range parameters, default the end date to ${isoDate}. For multi-part questions, search each part separately. State only facts from results; never fabricate URLs or facts.`,
		``,
		`When asked to build an interactive application, game, or visualization, create a single self-contained HTML file with embedded CSS and JS.`,
		`If a tool generates an image, inline it: ![alt](url). If a tool needs an image, use references ("image_1", "image_2", …) unless the tool description requires a full URL or a previous tool returned one.`,
	].join("\n");
}
