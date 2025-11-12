import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { KeyValuePair } from "$lib/types/Tool";
import type { RequestHandler } from "./$types";

// URL validation – match rules used by /api/fetch-url (security-reviewed)
function isValidUrl(urlString: string): boolean {
    try {
        const u = new URL(urlString);
        if (u.protocol !== "https:") return false; // HTTPS only
        const hostname = u.hostname.toLowerCase();
        if (
            hostname === "localhost" ||
            hostname.startsWith("127.") ||
            hostname.startsWith("192.168.") ||
            hostname.startsWith("172.16.") ||
            hostname === "[::1]" ||
            hostname === "0.0.0.0"
        ) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

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

export const POST: RequestHandler = async ({ request }) => {
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

		// Convert KeyValuePair[] to Record<string, string>
		const headersRecord: Record<string, string> = headers?.length
			? Object.fromEntries(headers.map((h) => [h.key, h.value]))
			: {};

		// Add required Accept header for MCP servers (like Exa)
		if (!headersRecord["Accept"]) {
			headersRecord["Accept"] = "application/json, text/event-stream";
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
