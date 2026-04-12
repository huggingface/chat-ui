import type { OpenAiTool } from "$lib/server/mcp/tools";

/**
 * Validate an IANA timezone string by attempting to use it with Intl.DateTimeFormat.
 * Returns the timezone if valid, otherwise undefined.
 */
function validTimezone(tz: string | undefined): string | undefined {
	if (!tz) return undefined;
	try {
		Intl.DateTimeFormat("en-US", { timeZone: tz });
		return tz;
	} catch {
		return undefined;
	}
}

export function buildToolPreprompt(tools: OpenAiTool[], timezone?: string): string {
	if (!Array.isArray(tools) || tools.length === 0) return "";
	const names = tools
		.map((t) => (t?.function?.name ? String(t.function.name) : ""))
		.filter((s) => s.length > 0);
	if (names.length === 0) return "";
	const now = new Date();
	const tz = validTimezone(timezone) ?? "UTC";
	const currentDate = now.toLocaleDateString("en-US", {
		timeZone: tz,
		year: "numeric",
		month: "long",
		day: "numeric",
		weekday: "long",
	});
	const currentTime = now.toLocaleTimeString("en-US", {
		timeZone: tz,
		hour: "numeric",
		minute: "2-digit",
	});
	// Build ISO-style date components in the user's timezone
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	})
		.formatToParts(now)
		.reduce(
			(acc, p) => {
				acc[p.type] = p.value;
				return acc;
			},
			{} as Record<string, string>
		);
	const isoDate = `${parts.year}-${parts.month}-${parts.day}`;
	const isoTime = `${parts.hour}:${parts.minute}:${parts.second}`;
	const year = parts.year;
	return [
		`You have access to these tools: ${names.join(", ")}.`,
		`Current date and time: ${currentDate}, ${currentTime} (${tz}). ISO: ${isoDate}T${isoTime}.`,
		`IMPORTANT: Do NOT call a tool unless the user's request requires capabilities you lack (e.g., real-time data, image generation, code execution) or external information you do not have. For tasks like writing code, creative writing, math, or building apps, respond directly without tools. When in doubt, do not use a tool.`,
		`PARALLEL TOOL CALLS: When multiple tool calls are needed and they are independent of each other (i.e., one does not need the result of another), call them all at once in a single response instead of one at a time. Only chain tool calls sequentially when a later call depends on an earlier call's output.`,
		`SEARCH: Use 3-6 precise keywords. For historical events, include the year the event occurred. For recent or current topics, use today's year (${year}). When a tool accepts date-range parameters (e.g., startPublishedDate, endPublishedDate), always use today's date (${isoDate}) as the end date unless the user specifies otherwise. For multi-part questions, search each part separately.`,
		`ANSWER: State only facts explicitly in the results. If info is missing or results conflict, say so. Never fabricate URLs or facts.`,
		`INTERACTIVE APPS: When asked to build an interactive application, game, or visualization without a specific language/framework preference, create a single self-contained HTML file with embedded CSS and JavaScript.`,
		`If a tool generates an image, you can inline it directly: ![alt text](image_url).`,
		`If a tool needs an image, set its image field ("input_image", "image", or "image_url") to a reference like "image_1", "image_2", etc. (ordered by when the user uploaded them).`,
		`Default to image references; only use a full http(s) URL when the tool description explicitly asks for one, or reuse a URL a previous tool returned.`,
	].join(" ");
}
