import type { McpServerConfig } from "./httpClient";
import { isConnectionClosedError, isSessionExpiredError, getMcpToolTimeoutMs } from "./httpClient";
import { getClient, evictFromPool, retainClient, releaseClient } from "./clientPool";
import { getMcpCatalog, type CachedServerResource, type ServerCatalog } from "./tools";
import { logger } from "$lib/server/logger";

/**
 * Cap on the text handed back to the model for one resource. A resource is arbitrary
 * server-side data — a whole log file or dataset is a legitimate resource — and an
 * unbounded read would blow the context window and the turn's budget with it.
 */
const MAX_RESOURCE_TEXT_CHARS = 32_000;

/** Cap on the listing, for the same reason. Listings are far cheaper per entry than reads. */
const MAX_LISTED_RESOURCES = 200;

export type McpResourceReadResult = {
	text: string;
	isError: boolean;
};

type ResourceContent = {
	uri?: unknown;
	mimeType?: unknown;
	text?: unknown;
	blob?: unknown;
};

function truncate(text: string, limit: number): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}\n\n[Truncated: the resource is ${text.length} characters, ${limit} shown.]`;
}

/**
 * Compile a level-1 RFC 6570 template into an anchored matcher. Only used to work out which
 * server owns a URI, so it deliberately does not try to extract variables — an over-broad
 * match would still route to a server that can answer for the URI, and a server that cannot
 * says so.
 */
function templateToRegExp(uriTemplate: string): RegExp | undefined {
	const literals = uriTemplate.split(/\{[^{}]*\}/g);
	if (literals.length < 2) return undefined;
	const pattern = literals.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+?");
	try {
		return new RegExp(`^${pattern}$`);
	} catch {
		return undefined;
	}
}

function describeResource(server: string, resource: CachedServerResource): string {
	const parts = [`- ${resource.uri}`];
	if (resource.name) parts.push(`name: ${resource.name}`);
	if (resource.mimeType) parts.push(`type: ${resource.mimeType}`);
	parts.push(`server: ${server}`);
	const line = parts.join(" | ");
	return resource.description ? `${line}\n    ${resource.description}` : line;
}

/**
 * Which server can serve `uri`: an enumerated resource wins, then a template whose shape it
 * fits. A URI matching nothing is reported as unresolvable rather than broadcast to every
 * server, so a typo costs one message instead of a round trip per connected server.
 */
function resolveOwner(
	servers: McpServerConfig[],
	catalogs: ServerCatalog[],
	uri: string
): McpServerConfig | undefined {
	for (const [index, server] of servers.entries()) {
		if (catalogs[index].resources.some((resource) => resource.uri === uri)) return server;
	}
	for (const [index, server] of servers.entries()) {
		for (const template of catalogs[index].templates) {
			if (templateToRegExp(template.uriTemplate)?.test(uri)) return server;
		}
	}
	return undefined;
}

export async function listMcpResources(
	servers: McpServerConfig[],
	{ signal }: { signal?: AbortSignal } = {}
): Promise<string> {
	const catalogs = await getMcpCatalog(servers, { signal });

	const lines: string[] = [];
	let total = 0;
	let omitted = 0;

	for (const [index, server] of servers.entries()) {
		for (const resource of catalogs[index].resources) {
			total += 1;
			if (lines.length >= MAX_LISTED_RESOURCES) {
				omitted += 1;
				continue;
			}
			lines.push(describeResource(server.name, resource));
		}
	}

	const templateLines: string[] = [];
	for (const [index, server] of servers.entries()) {
		for (const template of catalogs[index].templates) {
			const parts = [`- ${template.uriTemplate}`];
			if (template.name) parts.push(`name: ${template.name}`);
			if (template.mimeType) parts.push(`type: ${template.mimeType}`);
			parts.push(`server: ${server.name}`);
			const line = parts.join(" | ");
			templateLines.push(template.description ? `${line}\n    ${template.description}` : line);
		}
	}

	if (lines.length === 0 && templateLines.length === 0) {
		return "No resources are exposed by the connected MCP servers.";
	}

	const sections: string[] = [];
	if (lines.length > 0) {
		const heading =
			omitted > 0
				? `Available MCP resources (${lines.length} of ${total} shown):`
				: `Available MCP resources (${total}):`;
		sections.push([heading, ...lines].join("\n"));
	}
	if (templateLines.length > 0) {
		sections.push(
			[`Resource URI templates (expand the {placeholders} to form a URI):`, ...templateLines].join(
				"\n"
			)
		);
	}
	return sections.join("\n\n");
}

export async function readMcpResource(
	servers: McpServerConfig[],
	uri: string,
	{ signal, timeoutMs }: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<McpResourceReadResult> {
	if (typeof uri !== "string" || uri.trim().length === 0) {
		return { text: "A `uri` argument is required.", isError: true };
	}

	const catalogs = await getMcpCatalog(servers, { signal });
	const server = resolveOwner(servers, catalogs, uri);
	if (!server) {
		return {
			text: `No connected MCP server exposes the resource "${uri}". Call the resource listing function to see the available URIs.`,
			isError: true,
		};
	}

	const effectiveTimeoutMs = timeoutMs ?? getMcpToolTimeoutMs();
	let activeClient = await getClient(server, signal);

	// Mirrors callMcpTool: a pooled connection can be reaped by a proxy or lost to a server
	// restart between calls, and the retry is on a genuinely fresh client.
	const maxReconnectAttempts = 2;
	let response;
	for (let attempt = 0; ; attempt++) {
		const currentClient = activeClient;
		retainClient(currentClient);
		try {
			response = await currentClient.readResource({ uri }, { signal, timeout: effectiveTimeoutMs });
			break;
		} catch (err) {
			if (
				attempt >= maxReconnectAttempts ||
				signal?.aborted ||
				!(isConnectionClosedError(err) || isSessionExpiredError(err))
			) {
				throw err;
			}
			const stale = evictFromPool(server);
			stale?.close?.().catch(() => {});
			if (attempt > 0) {
				await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
			}
			activeClient = await getClient(server, signal);
		} finally {
			releaseClient(currentClient);
		}
	}

	const contents = Array.isArray(response?.contents)
		? (response.contents as ResourceContent[])
		: [];

	const rendered: string[] = [];
	for (const content of contents) {
		if (typeof content?.text === "string") {
			rendered.push(content.text);
			continue;
		}
		if (typeof content?.blob === "string") {
			// Binary contents are base64; inlining them would spend the context window on bytes
			// the model cannot read anyway, so report what is there instead.
			const mimeType = typeof content.mimeType === "string" ? content.mimeType : "unknown type";
			const approxBytes = Math.floor((content.blob.length * 3) / 4);
			rendered.push(`[Binary content: ${mimeType}, ~${approxBytes} bytes, not inlined.]`);
		}
	}

	if (rendered.length === 0) {
		return { text: `The resource "${uri}" returned no readable content.`, isError: false };
	}

	logger.debug({ server: server.name, uri }, "[mcp] read resource");
	return { text: truncate(rendered.join("\n\n"), MAX_RESOURCE_TEXT_CHARS), isError: false };
}
