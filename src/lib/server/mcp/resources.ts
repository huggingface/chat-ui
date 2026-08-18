import type { McpServerConfig } from "./httpClient";
import { isConnectionClosedError, isSessionExpiredError, getMcpToolTimeoutMs } from "./httpClient";
import { getClient, evictFromPool, retainClient, releaseClient } from "./clientPool";
import { getMcpCatalog, type CachedServerResource, type ServerCatalog } from "./tools";
import { logger } from "$lib/server/logger";

/** A resource is arbitrary server data; unbounded, one read can swallow the context window. */
const MAX_RESOURCE_TEXT_CHARS = 32_000;
const MAX_LISTED_RESOURCES = 200;
/** Templates get their own budget so a long resource listing can never starve them out. */
const MAX_LISTED_TEMPLATES = 50;

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

/** Routing only, so variables are deliberately not extracted — an over-broad match is harmless. */
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

/** Every server that could serve `uri`; an enumerated match outranks a template one. */
function resolveOwners(
	servers: McpServerConfig[],
	catalogs: ServerCatalog[],
	uri: string
): McpServerConfig[] {
	const enumerated = servers.filter((_, index) =>
		catalogs[index].resources.some((resource) => resource.uri === uri)
	);
	if (enumerated.length > 0) return enumerated;
	return servers.filter((_, index) =>
		catalogs[index].templates.some((template) => templateToRegExp(template.uriTemplate)?.test(uri))
	);
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
	let templateTotal = 0;
	for (const [index, server] of servers.entries()) {
		for (const template of catalogs[index].templates) {
			templateTotal += 1;
			if (templateLines.length >= MAX_LISTED_TEMPLATES) continue;
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
		const shown =
			templateTotal > templateLines.length ? `${templateLines.length} of ${templateTotal}` : null;
		const heading = shown
			? `Resource URI templates (${shown} shown; expand the {placeholders} to form a URI):`
			: `Resource URI templates (expand the {placeholders} to form a URI):`;
		sections.push([heading, ...templateLines].join("\n"));
	}
	return sections.join("\n\n");
}

export async function readMcpResource(
	servers: McpServerConfig[],
	uri: string,
	{
		signal,
		timeoutMs,
		server: serverName,
	}: { signal?: AbortSignal; timeoutMs?: number; server?: string } = {}
): Promise<McpResourceReadResult> {
	if (typeof uri !== "string" || uri.trim().length === 0) {
		return { text: "A `uri` argument is required.", isError: true };
	}

	const catalogs = await getMcpCatalog(servers, { signal });
	const owners = resolveOwners(servers, catalogs, uri);
	const candidates = serverName ? owners.filter((owner) => owner.name === serverName) : owners;

	if (candidates.length === 0) {
		return {
			text: serverName
				? `The MCP server "${serverName}" does not expose the resource "${uri}". Call the resource listing function to see the available URIs.`
				: `No connected MCP server exposes the resource "${uri}". Call the resource listing function to see the available URIs.`,
			isError: true,
		};
	}
	// Guessing between servers would silently return one server's document in another's name.
	if (candidates.length > 1) {
		const names = candidates.map((candidate) => `"${candidate.name}"`).join(", ");
		return {
			text: `The resource "${uri}" is exposed by more than one server (${names}). Retry with the \`server\` argument set to the one you want.`,
			isError: true,
		};
	}
	const server = candidates[0];

	const effectiveTimeoutMs = timeoutMs ?? getMcpToolTimeoutMs();
	let activeClient = await getClient(server, signal);

	// Mirrors callMcpTool: a pooled connection can be reaped by a proxy between calls.
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
			// Never inline: base64 the model cannot read would spend the context window on bytes.
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
