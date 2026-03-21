import type { MCPRegistryEntry, MCPRegistryIcon } from "$lib/types/Tool";

const REGISTRY_BASE_URL = "https://registry.modelcontextprotocol.io";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
	data: MCPRegistryEntry[];
	timestamp: number;
}

// Raw shapes returned by the official MCP Registry API
interface RegistryRemoteHeader {
	name: string;
	description?: string;
	isRequired?: boolean;
	isSecret?: boolean;
}

interface RegistryRemote {
	type: string;
	url: string;
	headers?: RegistryRemoteHeader[];
}

export interface RegistryServer {
	name: string;
	title?: string;
	description?: string;
	remotes?: RegistryRemote[];
	icons?: MCPRegistryIcon[];
}

interface RegistryResponseItem {
	server: RegistryServer;
	_meta?: unknown;
}

interface RegistryResponse {
	servers: RegistryResponseItem[];
	metadata?: { nextCursor?: string; count?: number };
}

const cache = new Map<string, CacheEntry>();

function normalizeServer(server: RegistryServer): MCPRegistryEntry | null {
	// Prefer StreamableHTTP, fall back to SSE, then any remote
	const remote =
		server.remotes?.find((r) => r.type === "streamable-http" || r.type === "http") ??
		server.remotes?.find((r) => r.type === "sse") ??
		server.remotes?.[0];

	// Only include servers with a remote URL (skip package-only servers)
	if (!remote?.url) return null;

	const requiredHeaders = remote.headers
		?.filter((h) => h.isRequired)
		.map((h) => ({ name: h.name, description: h.description, isSecret: h.isSecret }));

	return {
		name: server.name,
		title: server.title,
		description: server.description ?? "",
		url: remote.url,
		icons: server.icons,
		...(requiredHeaders?.length ? { requiredHeaders } : {}),
	};
}

async function fetchFromRegistry(search: string, limit: number): Promise<MCPRegistryEntry[]> {
	// Request more entries than needed since we filter to remote-only
	const fetchLimit = Math.min(limit * 5, 100);
	const url = new URL(`${REGISTRY_BASE_URL}/v0.1/servers`);
	if (search) url.searchParams.set("search", search);
	url.searchParams.set("limit", String(fetchLimit));

	const response = await fetch(url.toString(), {
		headers: { Accept: "application/json" },
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		throw new Error(`Registry API returned ${response.status}`);
	}

	const data = (await response.json()) as RegistryResponse;
	const entries: MCPRegistryEntry[] = [];

	const seen = new Set<string>();
	for (const item of data.servers) {
		const entry = normalizeServer(item.server);
		if (entry && !seen.has(entry.name)) {
			seen.add(entry.name);
			entries.push(entry);
			if (entries.length >= limit) break;
		}
	}

	return entries;
}

export async function GET({ url }: { url: URL }) {
	const search = url.searchParams.get("search") ?? "";
	const limit = Math.min(100, Number(url.searchParams.get("limit")) || 20);

	const cacheKey = `${search}|${limit}`;
	const cached = cache.get(cacheKey);
	const now = Date.now();

	if (cached && now - cached.timestamp < CACHE_TTL_MS) {
		return Response.json(cached.data);
	}

	try {
		const entries = await fetchFromRegistry(search, limit);
		cache.set(cacheKey, { data: entries, timestamp: now });
		return Response.json(entries);
	} catch (err) {
		console.error("MCP registry fetch failed:", err);
		return Response.json({ error: "Registry unavailable" }, { status: 502 });
	}
}
