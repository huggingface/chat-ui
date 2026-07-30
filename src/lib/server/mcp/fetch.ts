import { logger } from "$lib/server/logger";
import { mcpFetch } from "$lib/server/urlSafety";
import type { McpServerConfig } from "./httpClient";

export function mcpFetchForServer(server: McpServerConfig): typeof fetch {
	return async (input: RequestInfo | URL, init?: RequestInit) => {
		const response = await mcpFetch(
			input instanceof Request ? input.url : input,
			input instanceof Request
				? {
						method: input.method,
						headers: input.headers,
						body: input.body,
						signal: input.signal,
						...init,
					}
				: init
		);
		// Only inspect error responses for an OAuth scope challenge. Cloning a 2xx streamable-HTTP
		// (SSE) body and abandoning the clone deadlocks the stream the MCP SDK is reading, hanging
		// connect() forever. Challenges are always 4xx, so gating on !ok is safe.
		if (server.oauthChallengeHandler && !response.ok) {
			try {
				await server.oauthChallengeHandler(response.clone());
			} catch (error) {
				logger.warn(
					{ server: server.name, err: error instanceof Error ? error.message : String(error) },
					"[mcp] failed to record OAuth scope challenge"
				);
			}
		}
		return response;
	};
}
