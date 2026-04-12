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

	// Build a user-location hint from the IANA timezone (e.g. "America/New_York" → "America/New_York")
	const locationLine = timezone ? ` User's timezone: ${timezone}.` : "";

	return [
		`You have access to these tools: ${names.join(", ")}.`,
		`Current date and time: ${currentDateTime}.${locationLine}`,
		`Only use a tool if you cannot answer without it. For simple tasks like writing, editing text, or answering from your knowledge, respond directly without tools.`,
		`If a tool generates an image, you can inline it directly: ![alt text](image_url).`,
		`If a tool needs an image, set its image field ("input_image", "image", or "image_url") to a reference like "image_1", "image_2", etc. (ordered by when the user uploaded them).`,
		`Default to image references; only use a full http(s) URL when the tool description explicitly asks for one, or reuse a URL a previous tool returned.`,
	].join(" ");
}
