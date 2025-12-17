/**
 * Direct Exa API integration - bypasses mcp.exa.ai for faster responses
 *
 * Instead of: MCP protocol → mcp.exa.ai (slow) → Exa API
 * We do:      Direct call → api.exa.ai (fast)
 */

import { config } from "$lib/server/config";
import type { McpServerConfig, McpToolTextResponse } from "./httpClient";

const EXA_API_BASE = "https://api.exa.ai";
const DEFAULT_TIMEOUT_MS = 30_000;

// Tool definitions matching what Exa MCP server exposes
type ListedTool = {
	name: string;
	inputSchema?: Record<string, unknown>;
	description?: string;
};

/**
 * Detect if a server is the Exa MCP server
 */
export function isExaServer(server: McpServerConfig): boolean {
	try {
		const url = new URL(server.url);
		return url.hostname.toLowerCase() === "mcp.exa.ai";
	} catch {
		return false;
	}
}

/**
 * Extract Exa API key from server URL or config
 */
export function getExaApiKey(server: McpServerConfig): string | undefined {
	// First check URL params (e.g., ?exaApiKey=xxx)
	try {
		const url = new URL(server.url);
		const urlKey = url.searchParams.get("exaApiKey");
		if (urlKey) return urlKey;
	} catch {}

	// Fall back to config
	const configKey = config.EXA_API_KEY;
	if (configKey && configKey.trim().length > 0) {
		return configKey;
	}

	return undefined;
}

/**
 * Hardcoded tool definitions for Exa (matches what mcp.exa.ai returns)
 */
export function getExaToolDefinitions(): ListedTool[] {
	return [
		{
			name: "web_search_exa",
			description:
				"Search the web using Exa AI. Returns relevant web pages with titles, URLs, and content snippets.",
			inputSchema: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "The search query",
					},
					numResults: {
						type: "number",
						description: "Number of results to return (default: 10, max: 100)",
					},
					type: {
						type: "string",
						enum: ["auto", "neural", "keyword"],
						description: "Search type (default: auto)",
					},
					includeDomains: {
						type: "array",
						items: { type: "string" },
						description: "Only include results from these domains",
					},
					excludeDomains: {
						type: "array",
						items: { type: "string" },
						description: "Exclude results from these domains",
					},
				},
				required: ["query"],
			},
		},
		{
			name: "get_code_context_exa",
			description:
				"Search for code snippets, documentation, and programming resources. Optimized for finding code examples and technical documentation.",
			inputSchema: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "The code or programming-related search query",
					},
					numResults: {
						type: "number",
						description: "Number of results to return (default: 10)",
					},
				},
				required: ["query"],
			},
		},
	];
}

interface ExaSearchResult {
	title: string;
	url: string;
	id: string;
	score?: number;
	publishedDate?: string;
	author?: string;
	text?: string;
	highlights?: string[];
	highlightScores?: number[];
	summary?: string;
}

interface ExaSearchResponse {
	requestId: string;
	resolvedSearchType: string;
	results: ExaSearchResult[];
	costDollars?: Record<string, number>;
}

/**
 * Format Exa search results as human-readable text
 */
function formatSearchResultsAsText(results: ExaSearchResult[]): string {
	if (results.length === 0) {
		return "No results found.";
	}

	return results
		.map((result, index) => {
			const parts = [`${index + 1}. ${result.title}`, `   URL: ${result.url}`];

			if (result.publishedDate) {
				parts.push(`   Published: ${result.publishedDate}`);
			}

			if (result.text) {
				parts.push(`   ${result.text}`);
			} else if (result.highlights && result.highlights.length > 0) {
				parts.push(`   ${result.highlights.join(" ... ")}`);
			}

			return parts.join("\n");
		})
		.join("\n\n");
}

/**
 * Call Exa API directly (bypasses MCP protocol)
 */
export async function callExaDirectApi(
	tool: string,
	args: Record<string, unknown>,
	apiKey: string,
	options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<McpToolTextResponse> {
	const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	// Both tools use the /search endpoint
	if (tool !== "web_search_exa" && tool !== "get_code_context_exa") {
		throw new Error(`Unsupported Exa tool: ${tool}`);
	}

	const query = args.query as string;
	if (!query || typeof query !== "string") {
		throw new Error("Missing required parameter: query");
	}

	// Build request body - pass through all args, ensure query exists and request text content
	const requestBody: Record<string, unknown> = {
		...args,
		query,
		// Required to get page text content, not just metadata
		contents: {
			text: true,
		},
	};

	// Create abort controller for timeout
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	// Combine with external signal if provided
	if (options?.signal) {
		options.signal.addEventListener("abort", () => controller.abort());
	}

	const startTime = Date.now();
	console.log(`[EXA DIRECT] Calling /search for "${query}" (${tool})`);

	try {
		const response = await fetch(`${EXA_API_BASE}/search`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
			},
			body: JSON.stringify(requestBody),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			const errorText = await response.text();
			console.log(`[EXA DIRECT] API error: ${response.status} - ${errorText}`);
			throw new Error(`Exa API error: ${response.status} ${response.statusText} - ${errorText}`);
		}

		const data = (await response.json()) as ExaSearchResponse;
		const duration = Date.now() - startTime;
		console.log(
			`[EXA DIRECT] Success in ${duration}ms - ${data.results.length} results (type: ${data.resolvedSearchType})`
		);

		// Format response to match MCP tool response format
		const text = formatSearchResultsAsText(data.results);

		return {
			text,
			structured: data.results,
			content: [{ type: "text", text }],
		};
	} catch (err) {
		clearTimeout(timeoutId);
		const duration = Date.now() - startTime;

		if (err instanceof Error && err.name === "AbortError") {
			console.log(`[EXA DIRECT] Timeout after ${duration}ms`);
			throw new Error(`Exa API request timed out after ${timeoutMs}ms`);
		}

		console.log(`[EXA DIRECT] Failed after ${duration}ms: ${err}`);
		throw err;
	}
}
