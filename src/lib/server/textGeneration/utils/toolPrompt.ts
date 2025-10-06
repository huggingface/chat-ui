import type { OpenAiTool } from "$lib/server/mcp/tools";

export function buildToolPreprompt(tools: OpenAiTool[]): string {
	if (!Array.isArray(tools) || tools.length === 0) {
		return "";
	}

	return `When using tools follow those rules:

- Decompose the user's request into distinct goals. When it mentions multiple entities (e.g., "X and Y") or sub-questions, issue a separate tool call for each.
- When a tool can produce information more accurately or faster than guessing, call it.
- After each tool result, check whether every part of the user's request is resolved. If not, refine the query or call another tool.
- When tool outputs include URLs, cite them inline using bracketed indices like [1] and reuse the same index for repeat URLs. Only use indices that appear in the source mapping you are given—never invent new numbers, cite plain version numbers, or create a separate "Sources" section.
- Base the final answer solely on tool results; if the results leave gaps, say you don't know, and do not mention the tool names in the final response.`;
}
