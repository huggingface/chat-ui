/**
 * MCP Servers Store
 * Manages base (env-configured) and custom (user-added) MCP servers
 * Stores custom servers and selection state in browser localStorage
 */

import { writable, derived } from "svelte/store";
import { base } from "$app/paths";
import { browser } from "$app/environment";
import { BrowserOAuthClientProvider } from "$lib/mcp/auth/browserProvider";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import type { MCPServer, ServerStatus, MCPTool, KeyValuePair } from "$lib/types/Tool";

const STORAGE_KEYS = {
	CUSTOM_SERVERS: "mcp:custom-servers",
	SELECTED_IDS: "mcp:selected-ids",
} as const;

// Load custom servers from localStorage
function loadCustomServers(): MCPServer[] {
	if (!browser) return [];

	try {
		const json = localStorage.getItem(STORAGE_KEYS.CUSTOM_SERVERS);
		return json ? JSON.parse(json) : [];
	} catch (error) {
		console.error("Failed to load custom MCP servers from localStorage:", error);
		return [];
	}
}

// Load selected server IDs from localStorage
function loadSelectedIds(): Set<string> {
	if (!browser) return new Set();

	try {
		const json = localStorage.getItem(STORAGE_KEYS.SELECTED_IDS);
		const ids: string[] = json ? JSON.parse(json) : [];
		return new Set(ids);
	} catch (error) {
		console.error("Failed to load selected MCP server IDs from localStorage:", error);
		return new Set();
	}
}

// Save custom servers to localStorage
function saveCustomServers(servers: MCPServer[]) {
	if (!browser) return;

	try {
		localStorage.setItem(STORAGE_KEYS.CUSTOM_SERVERS, JSON.stringify(servers));
	} catch (error) {
		console.error("Failed to save custom MCP servers to localStorage:", error);
	}
}

// Save selected IDs to localStorage
function saveSelectedIds(ids: Set<string>) {
	if (!browser) return;

	try {
		localStorage.setItem(STORAGE_KEYS.SELECTED_IDS, JSON.stringify([...ids]));
	} catch (error) {
		console.error("Failed to save selected MCP server IDs to localStorage:", error);
	}
}

// Store for all servers (base + custom)
export const allMcpServers = writable<MCPServer[]>([]);

// Store for selected server IDs
export const selectedServerIds = writable<Set<string>>(loadSelectedIds());

// Auto-persist selected IDs when they change
if (browser) {
	selectedServerIds.subscribe((ids) => {
		saveSelectedIds(ids);
	});
}

// Derived store: only enabled servers
export const enabledServers = derived([allMcpServers, selectedServerIds], ([$all, $selected]) =>
	$all.filter((s) => $selected.has(s.id))
);

// Derived store: count of enabled servers
export const enabledServersCount = derived(enabledServers, ($enabled) => $enabled.length);

// Persist auth headers per server id
const AUTH_HEADERS_KEY = "mcp:auth_headers";
type AuthHeadersMap = Record<string, { key: string; value: string }[]>;

function loadAuthHeaders(): AuthHeadersMap {
  if (!browser) return {};
  try {
    return JSON.parse(localStorage.getItem(AUTH_HEADERS_KEY) || "{}");
  } catch {
    return {};
  }
}
const authServerIds = writable<Set<string>>(new Set());

function refreshAuthServerIdsFrom(map: AuthHeadersMap) {
  const ids = new Set<string>(Object.keys(map).filter((k) => (map[k]?.length ?? 0) > 0));
  authServerIds.set(ids);
}

function saveAuthHeaders(map: AuthHeadersMap) {
  if (!browser) return;
  localStorage.setItem(AUTH_HEADERS_KEY, JSON.stringify(map));
  refreshAuthServerIdsFrom(map);
}

// initialize auth ids on module load
if (browser) refreshAuthServerIdsFrom(loadAuthHeaders());

export { authServerIds };

function mergeHeaders(baseHeaders: KeyValuePair[] | undefined, extra: KeyValuePair[] | undefined): KeyValuePair[] | undefined {
  const out: Record<string, string> = {};
  for (const h of baseHeaders ?? []) out[h.key] = h.value;
  for (const h of extra ?? []) out[h.key] = h.value;
  const entries = Object.entries(out).map(([key, value]) => ({ key, value }));
  return entries.length ? entries : undefined;
}

// Derived: include stored auth headers (e.g., Authorization) with enabled servers
export const enabledServersWithAuth = derived([enabledServers], ([$enabled]) => {
  const authMap = loadAuthHeaders();
  return $enabled.map((s) => ({
    ...s,
    headers: mergeHeaders(s.headers, authMap[s.id]),
  }));
});

/**
 * Refresh base servers from API and merge with custom servers
 */
export async function refreshMcpServers() {
	try {
		const response = await fetch(`${base}/api/mcp/servers`);
		if (!response.ok) {
			throw new Error(`Failed to fetch base servers: ${response.statusText}`);
		}

		const baseServers: MCPServer[] = await response.json();
		const customServers = loadCustomServers();

		// Merge base and custom servers
		allMcpServers.set([...baseServers, ...customServers]);
	} catch (error) {
		console.error("Failed to refresh MCP servers:", error);
		// On error, just use custom servers
		allMcpServers.set(loadCustomServers());
	}
}

/**
 * Toggle a server on/off
 */
export function toggleServer(id: string) {
	selectedServerIds.update(($ids) => {
		const newSet = new Set($ids);
		if (newSet.has(id)) {
			newSet.delete(id);
		} else {
			newSet.add(id);
		}
		return newSet;
	});
}

/**
 * Add a custom MCP server
 */
export function addCustomServer(server: Omit<MCPServer, "id" | "type" | "status">): string {
	const newServer: MCPServer = {
		...server,
		id: crypto.randomUUID(),
		type: "custom",
		status: "disconnected",
	};

	const customServers = loadCustomServers();
	customServers.push(newServer);
	saveCustomServers(customServers);

	// Refresh all servers to include the new one
	refreshMcpServers();

	return newServer.id;
}

/**
 * Update an existing custom server
 */
export function updateCustomServer(id: string, updates: Partial<MCPServer>) {
	const customServers = loadCustomServers();
	const index = customServers.findIndex((s) => s.id === id);

	if (index !== -1) {
		customServers[index] = { ...customServers[index], ...updates };
		saveCustomServers(customServers);
		refreshMcpServers();
	}
}

/**
 * Delete a custom server
 */
export function deleteCustomServer(id: string) {
	const customServers = loadCustomServers();
	const filtered = customServers.filter((s) => s.id !== id);
	saveCustomServers(filtered);

	// Also remove from selected IDs
	selectedServerIds.update(($ids) => {
		const newSet = new Set($ids);
		newSet.delete(id);
		return newSet;
	});

	refreshMcpServers();
}

/**
 * Update server status (from health check)
 */
export function updateServerStatus(
    id: string,
    status: ServerStatus,
    errorMessage?: string,
    tools?: MCPTool[],
    authRequired?: boolean
) {
    allMcpServers.update(($servers) =>
        $servers.map((s) =>
            s.id === id
                ? {
                        ...s,
                        status,
                        errorMessage,
                        tools,
                        authRequired,
                    }
                : s
        )
    );
}

/**
 * Run health check on a server
 */
export async function healthCheckServer(
    server: MCPServer
): Promise<{ ready: boolean; tools?: MCPTool[]; error?: string }> {
    try {
        updateServerStatus(server.id, "connecting");

		// merge any stored auth headers for this server
		const withAuth: MCPServer = (() => {
			const authMap = loadAuthHeaders();
			return { ...server, headers: mergeHeaders(server.headers, authMap[server.id]) };
		})();

		const response = await fetch(`${base}/api/mcp/health`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: withAuth.url, headers: withAuth.headers }),
		});

        const result = await response.json();

        if (result.ready && result.tools) {
            updateServerStatus(server.id, "connected", undefined, result.tools, false);
            return { ready: true, tools: result.tools };
        } else {
            updateServerStatus(server.id, "error", result.error, undefined, Boolean(result.authRequired));
            return { ready: false, error: result.error };
        }
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		updateServerStatus(server.id, "error", errorMessage);
		return { ready: false, error: errorMessage };
	}
}

// Initialize on module load
if (browser) {
	refreshMcpServers();
}

// --- OAuth helpers ---
export async function authenticateServer(server: MCPServer): Promise<void> {
  if (!browser) return;
  const callbackUrl = new URL(`${base}/oauth/callback`, window.location.origin).toString();
  const provider = new BrowserOAuthClientProvider(server.url, {
    clientName: "chat-ui",
    callbackUrl,
  });

  // Listen for the popup callback message to finalize and persist header
  const onMessage = async (evt: MessageEvent) => {
    if (evt.origin !== window.location.origin) return;
    const data = evt.data as { type?: string; success?: boolean; error?: string };
    if (data?.type !== 'mcp_auth_callback') return;
    window.removeEventListener('message', onMessage);
    if (!data.success) {
      console.error('[mcp] OAuth failed:', data.error);
      return;
    }
    try {
      const tokens = await provider.tokens();
      if (!tokens?.access_token) return;
      const tokenType = (tokens as any).token_type || 'Bearer';
      const authHeader: KeyValuePair = { key: 'Authorization', value: `${tokenType} ${tokens.access_token}` };
      const map = loadAuthHeaders();
      map[server.id] = mergeHeaders(map[server.id], [authHeader]) ?? [];
      saveAuthHeaders(map);
      // Re-run health check to reflect status
      await healthCheckServer(server);
    } catch (e) {
      console.error('[mcp] Failed to store tokens', e);
    }
  };
  window.addEventListener('message', onMessage);

  try {
    await auth(provider, { serverUrl: server.url });
  } catch (e) {
    console.error('[mcp] auth() initiation failed', e);
    window.removeEventListener('message', onMessage);
  }
}

export function clearServerAuthentication(serverId: string) {
  if (!browser) return;
  const map = loadAuthHeaders();
  delete map[serverId];
  saveAuthHeaders(map);
}
