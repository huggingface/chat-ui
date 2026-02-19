import { isValidUrl } from "$lib/server/urlSafety";
import { safeFetch } from "$lib/server/fetchSafe";
import type { NativeTool } from "./types";

const MAX_RESPONSE_CHARS = 20_000;

export const fetchTool: NativeTool = {
	definition: {
		type: "function",
		function: {
			name: "fetch_url",
			description: "Fetches the content of a public HTTPS URL and returns it as text.",
			parameters: {
				type: "object",
				properties: {
					url: {
						type: "string",
						description: "The public HTTPS URL to fetch.",
					},
				},
				required: ["url"],
			},
		},
	},

	async execute(args: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<string> {
		const url = typeof args.url === "string" ? args.url.trim() : "";

		if (!url) {
			return "Error: Missing required parameter 'url'.";
		}

		if (!isValidUrl(url)) {
			return "Error: Invalid or unsafe URL. Only public HTTPS URLs are supported.";
		}

		try {
			const result = await safeFetch(url, { signal: opts?.signal });

			let body = result.text;
			if (body.length > MAX_RESPONSE_CHARS) {
				body = body.slice(0, MAX_RESPONSE_CHARS) + "\n\n[Content truncated]";
			}

			return `Status: ${result.statusCode}\nContent-Type: ${result.contentType}\nURL: ${url}\n\n${body}`;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return `Error fetching URL: ${message}`;
		}
	},
};
