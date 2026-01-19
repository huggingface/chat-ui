import type { OpenAiTool } from "$lib/server/mcp/tools";

/**
 * Categorize tools by their purpose to provide better guidance.
 */
function categorizeTools(tools: OpenAiTool[]): {
	generative: string[];
	search: string[];
	other: string[];
} {
	const generative: string[] = [];
	const search: string[] = [];
	const other: string[] = [];

	for (const tool of tools) {
		const name = tool?.function?.name ?? "";
		const desc = (tool?.function?.description ?? "").toLowerCase();
		if (!name) continue;

		// Detect generative tools (image/video/audio generation)
		if (
			desc.includes("generate") ||
			desc.includes("create image") ||
			desc.includes("create video") ||
			desc.includes("text-to-image") ||
			desc.includes("image generation") ||
			name.toLowerCase().includes("generate") ||
			name.toLowerCase().includes("_gen")
		) {
			generative.push(name);
		}
		// Detect search/retrieval tools
		else if (
			desc.includes("search") ||
			desc.includes("find") ||
			desc.includes("lookup") ||
			desc.includes("retrieve") ||
			desc.includes("fetch") ||
			name.toLowerCase().includes("search") ||
			name.toLowerCase().includes("lookup")
		) {
			search.push(name);
		} else {
			other.push(name);
		}
	}

	return { generative, search, other };
}

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

	const { generative, search } = categorizeTools(tools);

	const lines: string[] = [
		`You have access to tools: ${names.join(", ")}.`,
		`Today's date: ${currentDate}.`,
		"",
		"IMPORTANT - Tool Usage Guidelines:",
		"- ALWAYS prefer answering directly if you can. Only use tools when you genuinely need external information or capabilities.",
		"- For simple questions, text edits, spelling checks, or tasks you can do yourself: respond directly WITHOUT calling any tools.",
		"- When you have enough information from tool results, respond directly without making additional tool calls.",
		"- Do NOT use multiple tools in parallel for simple requests.",
	];

	// Add specific guidance for generative tools
	if (generative.length > 0) {
		lines.push(
			`- Generative tools (${generative.join(", ")}): ONLY use these when the user EXPLICITLY asks to generate/create something new. Do NOT use for editing text or prompts.`
		);
	}

	// Add specific guidance for search tools
	if (search.length > 0) {
		lines.push(
			`- Search tools (${search.join(", ")}): ONLY use when you need factual information you don't already know. Do NOT search for things you can answer from your training.`
		);
	}

	lines.push(
		"",
		"Image handling:",
		"- If a tool generates an image, inline it: ![alt text](image_url).",
		`- If a tool needs an image, use references like "image_1", "image_2" (ordered by user upload).`,
		"- Only use full http(s) URLs when the tool explicitly requires one, or reuse a URL from a previous tool result."
	);

	return lines.join("\n");
}
