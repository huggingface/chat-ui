import { createMcpClient } from "./client";
import type { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpServerConfig } from "./httpClient";
import { logger } from "$lib/server/logger";
import { mcpFetch } from "$lib/server/urlSafety";
// use console.* for lightweight diagnostics in production logs

export type OpenAiTool = {
	type: "function";
	function: { name: string; description?: string; parameters?: Record<string, unknown> };
};

/**
 * Behaviour hints a server declares for a tool. Advisory — the server chooses what to
 * claim. Deliberately not resolved against the spec's defaults (an undeclared tool is
 * `destructiveHint: true`), so a caller can tell "declared safe" from "said nothing".
 */
export type McpToolAnnotations = {
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
};

export interface McpToolMapping {
	fnName: string;
	server: string;
	tool: string;
	annotations?: McpToolAnnotations;
}

/** Two functions, not one per resource: a server may expose hundreds and crowd out its tools. */
export interface McpResourceFnMapping {
	fnName: string;
	kind: "resource";
	action: "list" | "read";
}

export type McpFunctionMapping = McpToolMapping | McpResourceFnMapping;

export function isResourceFn(
	mapping: McpFunctionMapping | undefined
): mapping is McpResourceFnMapping {
	return mapping !== undefined && "kind" in mapping && mapping.kind === "resource";
}

export const RESOURCE_LIST_FN = "list_mcp_resources";
export const RESOURCE_READ_FN = "read_mcp_resource";

// Tool listings are cached per server (url + headers), not per server set, so
// toggling one server never invalidates the others' entries. Headers are part
// of the key because they change what a server returns (e.g. the forwarded HF
// user token yields a per-user tool list on hf.co/mcp); that also means the key
// space grows with active users, hence the size cap.
type CachedServerTool = {
	name: string;
	description?: string;
	parameters?: Record<string, unknown>;
	annotations?: McpToolAnnotations;
};

export type CachedServerResource = {
	uri: string;
	name?: string;
	description?: string;
	mimeType?: string;
};

export type CachedServerResourceTemplate = {
	uriTemplate: string;
	name?: string;
	description?: string;
	mimeType?: string;
};

/** Tools and resources share this entry; listing them separately doubles connection churn. */
export type ServerCatalog = {
	tools: CachedServerTool[];
	resources: CachedServerResource[];
	templates: CachedServerResourceTemplate[];
};

const EMPTY_CATALOG: ServerCatalog = { tools: [], resources: [], templates: [] };

interface ServerCacheEntry {
	fetchedAt: number;
	ttlMs: number;
	catalog: ServerCatalog;
}

const DEFAULT_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 1_000;
const cache = new Map<string, ServerCacheEntry>();

// Per OpenAI tool/function name guidelines most providers enforce:
//   ^[a-zA-Z0-9_-]{1,64}$
// Dots are not universally accepted (e.g., MiniMax via HF router rejects them).
// Normalize any disallowed characters (including ".") to underscore and trim to 64 chars.
function sanitizeName(name: string) {
	return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function reserveName(candidate: string, taken: Record<string, unknown>): string {
	if (!(candidate in taken)) return candidate;
	for (let n = 2; n < 10; n += 1) {
		const next = `${candidate}_${n}`.slice(0, 64);
		if (!(next in taken)) return next;
	}
	return `${candidate}_mcp`.slice(0, 64);
}

const TYPE_IMPLYING_KEYWORDS = ["enum", "const", "$ref", "anyOf", "oneOf", "allOf", "not"] as const;
const OBJECT_IMPLYING_KEYWORDS = [
	"properties",
	"patternProperties",
	"additionalProperties",
	"propertyNames",
	"required",
] as const;
const ARRAY_IMPLYING_KEYWORDS = ["items", "prefixItems", "contains"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize an MCP tool's JSON Schema so strict OpenAI-compatible providers
 * (e.g. Fireworks) accept it. Some MCP servers (notably hf.co/mcp's `write_file`)
 * emit properties like `{ description, default: null }` with no `type`; providers
 * reject those under tool_choice:"auto", and one bad tool rejects the whole array.
 * Pure + non-mutating. Only recurses into real schema-bearing keywords, so instance
 * data (required, enum, defaults) and boolean additionalProperties stay intact.
 */
export function sanitizeJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(schema)) {
		if (key === "default" && value === null) continue; // drop contradictory/uninformative null defaults
		out[key] = value;
	}

	const recurse = (value: unknown): unknown =>
		isPlainObject(value) ? sanitizeJsonSchema(value) : value;
	const recurseMap = (map: Record<string, unknown>): Record<string, unknown> =>
		Object.fromEntries(Object.entries(map).map(([key, sub]) => [key, recurse(sub)]));

	// Object applicators: { name -> schema } maps, plus the key schema.
	if (isPlainObject(out.properties)) out.properties = recurseMap(out.properties);
	if (isPlainObject(out.patternProperties))
		out.patternProperties = recurseMap(out.patternProperties);
	if (isPlainObject(out.propertyNames)) out.propertyNames = sanitizeJsonSchema(out.propertyNames);
	// additionalProperties: schema form recurses; boolean form (true/false) is left untouched.
	if (isPlainObject(out.additionalProperties)) {
		out.additionalProperties = sanitizeJsonSchema(out.additionalProperties);
	}

	// Array applicators: single schema, tuple array, or contains schema.
	if (isPlainObject(out.items)) out.items = sanitizeJsonSchema(out.items);
	else if (Array.isArray(out.items)) out.items = out.items.map(recurse);
	if (Array.isArray(out.prefixItems)) out.prefixItems = out.prefixItems.map(recurse);
	if (isPlainObject(out.contains)) out.contains = sanitizeJsonSchema(out.contains);

	// Schema combinators.
	for (const kw of ["anyOf", "oneOf", "allOf"] as const) {
		const branch = out[kw];
		if (Array.isArray(branch)) out[kw] = branch.map(recurse);
	}
	if (isPlainObject(out.not)) out.not = sanitizeJsonSchema(out.not);

	// Ensure a `type` exists when none is implied. An empty `{}` is left as-is:
	// it means "match any value" (e.g. hf.co/mcp's `hf_jobs.args` arbitrary map),
	// so coercing it would wrongly narrow non-string arguments. Object/array
	// applicator keywords (properties, patternProperties, items, ...) imply the
	// container type, so a map/array schema is never narrowed to a string.
	if (out.type === undefined && Object.keys(out).length > 0) {
		if (OBJECT_IMPLYING_KEYWORDS.some((k) => k in out)) out.type = "object";
		else if (ARRAY_IMPLYING_KEYWORDS.some((k) => k in out)) out.type = "array";
		else if (!TYPE_IMPLYING_KEYWORDS.some((k) => k in out)) out.type = "string";
	}

	return out;
}

function serverCacheKey(server: McpServerConfig): string {
	const headers = server.headers
		? Object.entries(server.headers).sort(([a], [b]) => a.localeCompare(b))
		: [];
	return JSON.stringify([server.url, headers]);
}

function evictExpired(now: number) {
	for (const [key, entry] of cache) {
		if (now - entry.fetchedAt >= entry.ttlMs) {
			cache.delete(key);
		}
	}
}

function enforceCacheCap() {
	if (cache.size <= MAX_CACHE_ENTRIES) return;
	const oldestFirst = [...cache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
	for (const [key] of oldestFirst.slice(0, cache.size - MAX_CACHE_ENTRIES)) {
		cache.delete(key);
	}
}

type ListedTool = {
	name?: string;
	inputSchema?: Record<string, unknown>;
	description?: string;
	annotations?: Record<string, unknown>;
};

type ListedResource = {
	uri?: unknown;
	name?: unknown;
	title?: unknown;
	description?: unknown;
	mimeType?: unknown;
};

type ListedResourceTemplate = Omit<ListedResource, "uri"> & { uriTemplate?: unknown };

const MAX_RESOURCE_PAGES = 10;
const MAX_RESOURCES_PER_SERVER = 250;

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

async function listAllPages<T>(
	listPage: (params: { cursor?: string }) => Promise<unknown>,
	pick: (page: Record<string, unknown>) => unknown
): Promise<T[]> {
	const out: T[] = [];
	let cursor: string | undefined;

	for (let page = 0; page < MAX_RESOURCE_PAGES; page += 1) {
		const response = await listPage(cursor ? { cursor } : {});
		if (!isPlainObject(response)) break;

		const items = pick(response);
		if (Array.isArray(items)) out.push(...(items as T[]));

		cursor = optionalString(response.nextCursor);
		if (!cursor || out.length >= MAX_RESOURCES_PER_SERVER) break;
	}

	return out.slice(0, MAX_RESOURCES_PER_SERVER);
}

function normalizeResources(raw: ListedResource[]): CachedServerResource[] {
	const out: CachedServerResource[] = [];
	for (const resource of raw) {
		const uri = optionalString(resource?.uri);
		if (!uri) continue;
		out.push({
			uri,
			name: optionalString(resource.name),
			description: optionalString(resource.description) ?? optionalString(resource.title),
			mimeType: optionalString(resource.mimeType),
		});
	}
	return out;
}

function normalizeResourceTemplates(raw: ListedResourceTemplate[]): CachedServerResourceTemplate[] {
	const out: CachedServerResourceTemplate[] = [];
	for (const template of raw) {
		const uriTemplate = optionalString(template?.uriTemplate);
		if (!uriTemplate) continue;
		out.push({
			uriTemplate,
			name: optionalString(template.name),
			description: optionalString(template.description) ?? optionalString(template.title),
			mimeType: optionalString(template.mimeType),
		});
	}
	return out;
}

/** Never throws: a broken resource listing must not cost the server its tools. */
export async function listResourcesFor(
	client: Client,
	label: string,
	opts: { signal?: AbortSignal } = {}
): Promise<Pick<ServerCatalog, "resources" | "templates">> {
	// Without this an undeclaring server eats two guaranteed method-not-found round trips.
	if (!client.getServerCapabilities()?.resources) {
		return { resources: [], templates: [] };
	}

	const listed = await Promise.allSettled([
		listAllPages<ListedResource>(
			(params) => client.listResources(params, { signal: opts.signal }),
			(page) => page.resources
		),
		listAllPages<ListedResourceTemplate>(
			(params) => client.listResourceTemplates(params, { signal: opts.signal }),
			(page) => page.resourceTemplates
		),
	]);

	const [resourcesResult, templatesResult] = listed;
	if (resourcesResult.status === "rejected") {
		logger.debug(
			{ server: label, err: String(resourcesResult.reason) },
			"[mcp] failed to list resources for server"
		);
	}

	return {
		resources:
			resourcesResult.status === "fulfilled" ? normalizeResources(resourcesResult.value) : [],
		templates:
			templatesResult.status === "fulfilled"
				? normalizeResourceTemplates(templatesResult.value)
				: [],
	};
}

const ANNOTATION_HINTS = [
	"readOnlyHint",
	"destructiveHint",
	"idempotentHint",
	"openWorldHint",
] as const;

/** Booleans only: a truthy string must not be stored as a declared hint. */
function readAnnotations(raw: unknown): McpToolAnnotations | undefined {
	if (!isPlainObject(raw)) return undefined;

	const annotations: McpToolAnnotations = {};
	for (const hint of ANNOTATION_HINTS) {
		const value = raw[hint];
		if (typeof value === "boolean") annotations[hint] = value;
	}
	return Object.keys(annotations).length > 0 ? annotations : undefined;
}

async function listServerCatalog(
	server: McpServerConfig,
	opts: { signal?: AbortSignal } = {}
): Promise<{ tools: ListedTool[] } & Pick<ServerCatalog, "resources" | "templates">> {
	const url = new URL(server.url);
	const client = createMcpClient();
	try {
		try {
			const transport = new StreamableHTTPClientTransport(url, {
				requestInit: { headers: server.headers, signal: opts.signal },
				fetch: mcpFetch,
			});
			await client.connect(transport);
		} catch {
			const transport = new SSEClientTransport(url, {
				requestInit: { headers: server.headers, signal: opts.signal },
				fetch: mcpFetch,
			});
			await client.connect(transport);
		}

		const response = await client.listTools({});
		const tools = Array.isArray(response?.tools) ? (response.tools as ListedTool[]) : [];
		const { resources, templates } = await listResourcesFor(client, server.name, opts);
		try {
			logger.debug(
				{
					server: server.name,
					url: server.url,
					count: tools.length,
					toolNames: tools.map((t) => t?.name).filter(Boolean),
					resourceCount: resources.length,
					resourceTemplateCount: templates.length,
				},
				"[mcp] listed catalog from server"
			);
		} catch {}
		return { tools, resources, templates };
	} finally {
		try {
			await client.close?.();
		} catch {
			// ignore close errors
		}
	}
}

async function fetchServerCatalog(
	server: McpServerConfig,
	opts: { signal?: AbortSignal } = {}
): Promise<ServerCatalog> {
	const raw = await listServerCatalog(server, opts);
	const normalized: CachedServerTool[] = [];
	for (const tool of raw.tools) {
		if (typeof tool.name !== "string" || tool.name.trim().length === 0) {
			continue;
		}
		const title = typeof tool.annotations?.title === "string" ? tool.annotations.title : undefined;
		normalized.push({
			name: tool.name,
			description: tool.description ?? title,
			parameters: isPlainObject(tool.inputSchema)
				? sanitizeJsonSchema(tool.inputSchema)
				: undefined,
			annotations: readAnnotations(tool.annotations),
		});
	}
	return { tools: normalized, resources: raw.resources, templates: raw.templates };
}

export async function getMcpCatalog(
	servers: McpServerConfig[],
	{ ttlMs = DEFAULT_TTL_MS, signal }: { ttlMs?: number; signal?: AbortSignal } = {}
): Promise<ServerCatalog[]> {
	const now = Date.now();
	evictExpired(now);

	const listed = await Promise.all(
		servers.map(async (server): Promise<ServerCatalog> => {
			const key = serverCacheKey(server);
			const cached = cache.get(key);
			if (cached) {
				return cached.catalog;
			}
			try {
				const catalog = await fetchServerCatalog(server, { signal });
				cache.set(key, { fetchedAt: now, ttlMs, catalog });
				return catalog;
			} catch (err) {
				logger.debug(
					{ server: server.name, url: server.url, err: String(err) },
					"[mcp] failed to list catalog for server"
				);
				return EMPTY_CATALOG;
			}
		})
	);
	enforceCacheCap();
	return listed;
}

export async function getOpenAiToolsForMcp(
	servers: McpServerConfig[],
	{ ttlMs = DEFAULT_TTL_MS, signal }: { ttlMs?: number; signal?: AbortSignal } = {}
): Promise<{ tools: OpenAiTool[]; mapping: Record<string, McpFunctionMapping> }> {
	const catalogs = await getMcpCatalog(servers, { ttlMs, signal });
	const listed = catalogs.map((catalog) => catalog.tools);

	// Function names depend on the request's server combination (collision
	// suffixes), so definitions and mapping are rebuilt per request from the
	// cached per-server listings.
	const tools: OpenAiTool[] = [];
	const mapping: Record<string, McpFunctionMapping> = {};

	const seenNames = new Set<string>();

	const pushToolDefinition = (
		name: string,
		description: string | undefined,
		parameters: Record<string, unknown> | undefined
	) => {
		if (seenNames.has(name)) return;
		tools.push({
			type: "function",
			function: {
				name,
				description,
				parameters,
			},
		});
		seenNames.add(name);
	};

	for (const [index, server] of servers.entries()) {
		for (const tool of listed[index]) {
			// Emit a collision-aware function name.
			// Prefer the plain tool name; on conflict, suffix with server name.
			let plainName = sanitizeName(tool.name);
			if (plainName in mapping) {
				const suffix = sanitizeName(server.name);
				const candidate = `${plainName}_${suffix}`.slice(0, 64);
				if (!(candidate in mapping)) {
					plainName = candidate;
				} else {
					let n = 2;
					let next = `${candidate}_${n}`;
					while (n < 10 && next in mapping) {
						n += 1;
						next = `${candidate}_${n}`;
					}
					plainName = next.slice(0, 64);
				}
			}

			// Annotations stay off the tool definition: strict providers reject unknown fields.
			pushToolDefinition(plainName, tool.description, tool.parameters);
			mapping[plainName] = {
				fnName: plainName,
				server: server.name,
				tool: tool.name,
				...(tool.annotations ? { annotations: tool.annotations } : {}),
			};
		}
	}

	// Resource functions come last so a real tool never loses its plain name to them.
	const resourceServers = servers.filter(
		(_, index) => catalogs[index].resources.length > 0 || catalogs[index].templates.length > 0
	);
	if (resourceServers.length > 0) {
		const listFn = reserveName(RESOURCE_LIST_FN, mapping);
		const readFn = reserveName(RESOURCE_READ_FN, mapping);
		const serverList = resourceServers.map((server) => server.name).join(", ");

		pushToolDefinition(
			listFn,
			`List the read-only data resources exposed by the connected MCP servers (${serverList}). ` +
				`Returns each resource's URI, name, description and media type. Call this to discover a ` +
				`URI, then pass that URI to ${readFn} to read its contents.`,
			{ type: "object", properties: {}, additionalProperties: false }
		);
		mapping[listFn] = { fnName: listFn, kind: "resource", action: "list" };

		pushToolDefinition(
			readFn,
			`Read the contents of an MCP resource by its URI. Get URIs from ${listFn}. Resources are ` +
				`read-only reference data (files, documents, records), so reading one has no side effects.`,
			{
				type: "object",
				properties: {
					uri: {
						type: "string",
						description: `The resource URI exactly as reported by ${listFn}, e.g. "file:///notes.md".`,
					},
				},
				required: ["uri"],
				additionalProperties: false,
			}
		);
		mapping[readFn] = { fnName: readFn, kind: "resource", action: "read" };
	}

	return { tools, mapping };
}

export function resetMcpToolsCache() {
	cache.clear();
}
