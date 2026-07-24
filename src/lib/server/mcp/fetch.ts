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
		if (server.oauthChallengeHandler) {
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
