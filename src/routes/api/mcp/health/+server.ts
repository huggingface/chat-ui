import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { KeyValuePair } from "$lib/types/Tool";
import { config } from "$lib/server/config";
import type { RequestHandler } from "./$types";
import { isValidUrl } from "$lib/server/urlSafety";
import { isStrictHfMcpLogin, hasNonEmptyToken } from "$lib/server/mcp/hf";

interface HealthCheckRequest {
	url: string;
	headers?: KeyValuePair[];
}

interface HealthCheckResponse {
	ready: boolean;
	tools?: Array<{
		name: string;
		description?: string;
		inputSchema?: unknown;
	}>;
	error?: string;
	authRequired?: boolean;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	let client: Client | undefined;

	try {
		const body: HealthCheckRequest = await request.json();
		const { url, headers } = body;

		if (!url) {
			return new Response(JSON.stringify({ ready: false, error: "URL is required" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			});
		}

		// URL validation handled above

		if (!isValidUrl(url)) {
			return new Response(
				JSON.stringify({
					ready: false,
					error: "Invalid or unsafe URL (only HTTPS is supported)",
				} as HealthCheckResponse),
				{ status: 400, headers: { "Content-Type": "application/json" } }
			);
		}

		const baseUrl = new URL(url);

		// Minimal header handling
		const headersRecord: Record<string, string> = headers?.length
			? Object.fromEntries(headers.map((h) => [h.key, h.value]))
			: {};
		if (!headersRecord["Accept"]) {
			headersRecord["Accept"] = "application/json, text/event-stream";
		}

		// If enabled, attach the logged-in user's HF token only for the official HF MCP endpoint
		try {
			const shouldForward = config.MCP_FORWARD_HF_USER_TOKEN === "true";
			const userToken =
				(locals as unknown as { hfAccessToken?: string } | undefined)?.hfAccessToken ??
				(locals as unknown as { token?: string } | undefined)?.token;
			const hasAuth = typeof headersRecord["Authorization"] === "string";
			const isHfMcpTarget = isStrictHfMcpLogin(url);
			if (shouldForward && !hasAuth && isHfMcpTarget && hasNonEmptyToken(userToken)) {
				headersRecord["Authorization"] = `Bearer ${userToken}`;
			}
		} catch {
			// best-effort overlay
		}

		// Add an abort timeout to outbound requests (align with fetch-url: 30s)
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 30000);
		const signal = controller.signal;
		const requestInit: RequestInit = {
			headers: headersRecord,
			signal,
		};

		let lastError: Error | undefined;

		// Try Streamable HTTP transport first
		try {
			console.log(`[MCP Health] Trying HTTP transport for ${url}`);
			client = new Client({
				name: "chat-ui-health-check",
				version: "1.0.0",
			});

			const transport = new StreamableHTTPClientTransport(baseUrl, { requestInit });
			console.log(`[MCP Health] Connecting to ${url}...`);
			await client.connect(transport);
			console.log(`[MCP Health] Connected successfully via HTTP`);

			// Connection successful, get tools
			const toolsResponse = await client.listTools();

			// Disconnect after getting tools
			await client.close();

			if (toolsResponse && toolsResponse.tools) {
				const response: HealthCheckResponse = {
					ready: true,
					tools: toolsResponse.tools.map((tool) => ({
						name: tool.name,
						description: tool.description,
						inputSchema: tool.inputSchema,
					})),
					authRequired: false,
				};

				const res = new Response(JSON.stringify(response), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
				clearTimeout(timeoutId);
				return res;
			} else {
				const res = new Response(
					JSON.stringify({
						ready: false,
						error: "Connected but no tools available",
						authRequired: false,
					} as HealthCheckResponse),
					{
						status: 503,
						headers: { "Content-Type": "application/json" },
					}
				);
				clearTimeout(timeoutId);
				return res;
			}
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			console.log("Streamable HTTP failed, trying SSE transport...", lastError.message);

			// Close failed client
			try {
				await client?.close();
			} catch {
				// Ignore
			}

			// Try SSE transport
			try {
				console.log(`[MCP Health] Trying SSE transport for ${url}`);
				client = new Client({
					name: "chat-ui-health-check",
					version: "1.0.0",
				});

				const sseTransport = new SSEClientTransport(baseUrl, { requestInit });
				console.log(`[MCP Health] Connecting via SSE...`);
				await client.connect(sseTransport);
				console.log(`[MCP Health] Connected successfully via SSE`);

				// Connection successful, get tools
				const toolsResponse = await client.listTools();

				// Disconnect after getting tools
				await client.close();

				if (toolsResponse && toolsResponse.tools) {
					const response: HealthCheckResponse = {
						ready: true,
						tools: toolsResponse.tools.map((tool) => ({
							name: tool.name,
							description: tool.description,
							inputSchema: tool.inputSchema,
						})),
						authRequired: false,
					};

					const res = new Response(JSON.stringify(response), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
					clearTimeout(timeoutId);
					return res;
				} else {
					const res = new Response(
						JSON.stringify({
							ready: false,
							error: "Connected but no tools available",
							authRequired: false,
						} as HealthCheckResponse),
						{
							status: 503,
							headers: { "Content-Type": "application/json" },
						}
					);
					clearTimeout(timeoutId);
					return res;
				}
			} catch (sseError) {
				lastError = sseError instanceof Error ? sseError : new Error(String(sseError));
				console.error("Both transports failed. Last error:", lastError);
			}
		}

		// Both transports failed
		let errorMessage = lastError?.message || "Failed to connect to MCP server";

		// Detect unauthorized to signal auth requirement
		const lower = (errorMessage || "").toLowerCase();
		const authRequired =
			lower.includes("unauthorized") ||
			lower.includes("forbidden") ||
			lower.includes("401") ||
			lower.includes("403");

		// Provide more helpful error messages
		if (authRequired) {
			errorMessage =
				"Authentication required. Provide appropriate Authorization headers in the server configuration.";
		} else if (errorMessage.includes("not valid JSON")) {
			errorMessage =
				"Server returned invalid response. This might not be a valid MCP endpoint. MCP servers should respond to POST requests at /mcp with JSON-RPC messages.";
		} else if (errorMessage.includes("fetch failed") || errorMessage.includes("ECONNREFUSED")) {
			errorMessage = `Cannot connect to ${url}. Please verify the server is running and accessible.`;
		} else if (errorMessage.includes("CORS")) {
			errorMessage = `CORS error. The MCP server needs to allow requests from this origin.`;
		}

		const res = new Response(
			JSON.stringify({
				ready: false,
				error: errorMessage,
				authRequired,
			} as HealthCheckResponse),
			{
				status: 503,
				headers: { "Content-Type": "application/json" },
			}
		);
		clearTimeout(timeoutId);
		return res;
	} catch (error) {
		console.error("MCP health check failed:", error);

		// Clean up client if it exists
		try {
			await client?.close();
		} catch {
			// Ignore
		}

		const response: HealthCheckResponse = {
			ready: false,
			error: error instanceof Error ? error.message : "Unknown error",
		};

		const res = new Response(JSON.stringify(response), {
			status: 503,
			headers: { "Content-Type": "application/json" },
		});
		return res;
	}
};
