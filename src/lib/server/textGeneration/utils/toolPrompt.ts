import type { OpenAiTool } from "$lib/server/mcp/tools";

export function buildToolPreprompt(tools: OpenAiTool[], timezone?: string): string {
	if (!Array.isArray(tools) || tools.length === 0) return "";
	const names = tools
		.map((t) => (t?.function?.name ? String(t.function.name) : ""))
		.filter((s) => s.length > 0);
	if (names.length === 0) return "";
	const now = new Date();
	const dateTimeOptions: Intl.DateTimeFormatOptions = {
		year: "numeric",
		month: "long",
		day: "numeric",
		weekday: "long",
		hour: "2-digit",
		minute: "2-digit",
		...(timezone ? { timeZone: timezone } : {}),
	};
	const currentDateTime = now.toLocaleString("en-US", dateTimeOptions);
	const isoDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	const locationLine = timezone ? ` User's timezone: ${timezone}.` : "";
	return [
		`You have access to these tools: ${names.join(", ")}.`,
		`Current date and time: ${currentDateTime} (${isoDate}).${locationLine}`,
		`IMPORTANT: Do NOT call a tool unless the user's request requires capabilities you lack (e.g., real-time data, image generation, code execution) or external information you do not have. For tasks like writing code, creative writing, math, or building apps, respond directly without tools. When in doubt, do not use a tool.`,
		`PARALLEL TOOL CALLS: When multiple tool calls are needed and they are independent of each other (i.e., one does not need the result of another), call them all at once in a single response instead of one at a time. Only chain tool calls sequentially when a later call depends on an earlier call's output.`,
		`SEARCH: Use 3-6 precise keywords. For historical events, include the year the event occurred. For recent or current topics, use today's year (${now.getFullYear()}). When a tool accepts date-range parameters (e.g., startPublishedDate, endPublishedDate), always use today's date (${isoDate}) as the end date unless the user specifies otherwise. For multi-part questions, search each part separately. If the results only partially cover the question, run a follow-up search or crawl the most relevant result URL instead of answering from memory.`,
		`GROUNDING: Once you have used a search or content tool, the returned results are your ONLY source of facts for the answer. Do not blend in details from your own knowledge (employers, roles, dates, degrees, numbers, quotes) unless they appear in the results — plausible-sounding additions are hallucinations, especially about people and organizations. If a fact is not in the results, search again or explicitly say you could not verify it. Attribute key facts to their sources with markdown links to the result URLs. If results conflict, say so. Never fabricate URLs, citations, or facts.`,
		`INTERACTIVE APPS: When asked to build an interactive application, game, or visualization without a specific language/framework preference, create a single self-contained HTML file with embedded CSS and JavaScript.`,
		`If a tool generates an image, you can inline it directly: ![alt text](image_url).`,
		`If a tool needs an image, set its image field ("input_image", "image", or "image_url") to a reference like "image_1", "image_2", etc. (ordered by when the user uploaded them).`,
		`Default to image references; only use a full http(s) URL when the tool description explicitly asks for one, or reuse a URL a previous tool returned.`,
	].join(" ");
}

const RETRIEVAL_TOOL_RE = /search|crawl|fetch|browse|scrape|wiki|news|web|url|page|read/i;

/**
 * A short grounding reminder appended right after retrieval-style tool results.
 * Small models tend to forget system-prompt instructions once the context grows,
 * so re-stating the rule adjacent to the results is far more effective than the
 * preprompt alone. Returns an empty string when no executed tool looks like a
 * retrieval tool (e.g., image generation), where the reminder would be noise.
 */
export function buildToolResultsReminder(toolNames: string[]): string {
	if (!toolNames.some((name) => RETRIEVAL_TOOL_RE.test(name))) return "";
	return "[Reminder from system: answer strictly from the tool results above. Do not add facts from your own knowledge that the results do not contain — if something is missing, search again or say you could not verify it. Cite the result URLs for key facts.]";
}
