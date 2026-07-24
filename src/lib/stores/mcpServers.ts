/**
 * MCP Servers Store
 * Manages base (env-configured) and custom (user-added) MCP servers
 * Stores custom servers and selection state in browser localStorage
 */

import { writable, derived, get } from "svelte/store";
import { base } from "$app/paths";
import { env as publicEnv } from "$env/dynamic/public";
import { browser } from "$app/environment";
import type {
	KeyValuePair,
	MCPOAuthState,
	MCPServer,
	ServerStatus,
	MCPTool,
} from "$lib/types/Tool";
import { disconnectOAuthConnection, discoverServer } from "$lib/utils/mcpOAuth";

// Namespace storage by app identity to avoid collisions across apps
function toKeyPart(s: string | undefined): string {
	return (s || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

const appLabel = toKeyPart(publicEnv.PUBLIC_APP_ASSETS || publicEnv.PUBLIC_APP_NAME);
const baseLabel = toKeyPart(typeof base === "string" ? base : "");
// Final prefix format requested: "huggingchat:key" (no mcp:/chat)
const KEY_PREFIX = appLabel || baseLabel || "app";

const STORAGE_KEYS = {
	CUSTOM_SERVERS: `${KEY_PREFIX}:mcp:custom-servers`,
	SELECTED_IDS: `${KEY_PREFIX}:mcp:selected-ids`,
	DISABLED_BASE_IDS: `${KEY_PREFIX}:mcp:disabled-base-ids`,
} as const;

// No migration needed per request — read/write only namespaced keys

// Load custom servers from localStorage
function loadCustomServers(): MCPServer[] {
	if (!browser) return [];

	try {
		const json = localStorage.getItem(STORAGE_KEYS.CUSTOM_SERVERS);
		const parsed = json ? (JSON.parse(json) as unknown) : [];
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((server): server is MCPServer => Boolean(server && typeof server === "object"))
			.map(stripLegacyOAuthSecrets);
	} catch (error) {
		console.error("Failed to load custom MCP servers from localStorage:", error);
		return [];
	}
}

function stripLegacyOAuthSecrets(server: MCPServer): MCPServer {
	const raw = server.oauth as unknown;
	if (!raw || typeof raw !== "object") return server;
	const oauth = raw as Record<string, unknown>;
	if (
		typeof oauth.connectionId !== "string" ||
		typeof oauth.issuer !== "string" ||
		(oauth.status !== "authorized" && oauth.status !== "authorization_required")
	) {
		const clean = { ...server };
		delete clean.oauth;
		return { ...clean, authRequired: Boolean(server.authRequired || oauth.tokens) };
	}
	return {
		...server,
		oauth: {
			connectionId: oauth.connectionId,
			issuer: oauth.issuer,
			status: oauth.status,
			scope: typeof oauth.scope === "string" ? oauth.scope : undefined,
			expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : undefined,
			manualClientRequired:
				typeof oauth.manualClientRequired === "boolean" ? oauth.manualClientRequired : undefined,
			clientWasManuallyEntered:
				typeof oauth.clientWasManuallyEntered === "boolean"
					? oauth.clientWasManuallyEntered
					: undefined,
		},
	};
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

// Load disabled base server IDs from localStorage (empty set if missing or on error)
function loadDisabledBaseIds(): Set<string> {
	if (!browser) return new Set();

	try {
		const json = localStorage.getItem(STORAGE_KEYS.DISABLED_BASE_IDS);
		return new Set(json ? JSON.parse(json) : []);
	} catch (error) {
		console.error("Failed to load disabled base MCP server IDs from localStorage:", error);
		return new Set();
	}
}

// Save disabled base server IDs to localStorage
function saveDisabledBaseIds(ids: Set<string>) {
	if (!browser) return;

	try {
		localStorage.setItem(STORAGE_KEYS.DISABLED_BASE_IDS, JSON.stringify([...ids]));
	} catch (error) {
		console.error("Failed to save disabled base MCP server IDs to localStorage:", error);
	}
}

// Store for all servers (base + custom)
export const allMcpServers = writable<MCPServer[]>([]);

// Track if initial server load has completed
export const mcpServersLoaded = writable<boolean>(false);

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

// Derived store: true if all base servers are enabled
export const allBaseServersEnabled = derived(
	[allMcpServers, selectedServerIds],
	([$all, $selected]) => {
		const baseServers = $all.filter((s) => s.type === "base");
		return baseServers.length > 0 && baseServers.every((s) => $selected.has(s.id));
	}
);

// Note: Authorization overlay (with user's HF token) for the Hugging Face MCP host
// is applied server-side when enabled via MCP_FORWARD_HF_USER_TOKEN.

/**
 * Populate the MCP store from a known base-server list without making a network
 * request. Merges with any custom servers saved in localStorage, applies the
 * user's disabled-server preferences, and sets mcpServersLoaded synchronously.
 *
 * Called from the root layout script block with the server list that arrived in
 * the SSR payload, so the store is ready before any child onMount fires.
 * The background refreshMcpServers() call still runs to pick up status changes.
 */
export function initWithServers(baseServers: MCPServer[]): void {
	const customServers = loadCustomServers();

	// Merge base and custom servers
	const merged = [...baseServers, ...customServers];
	allMcpServers.set(merged);

	// Load disabled base servers
	const disabledBaseIds = loadDisabledBaseIds();

	// Auto-enable all base servers that aren't explicitly disabled.
	// Keep any custom servers that were previously selected and still exist.
	const validIds = new Set(merged.map((s) => s.id));
	selectedServerIds.update(($currentIds) => {
		const newSelection = new Set<string>();

		for (const server of baseServers) {
			if (!disabledBaseIds.has(server.id)) {
				newSelection.add(server.id);
			}
		}

		for (const id of $currentIds) {
			if (validIds.has(id) && !id.startsWith("base-")) {
				newSelection.add(id);
			}
		}

		return newSelection;
	});
	mcpServersLoaded.set(true);
}

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
		initWithServers(baseServers);
	} catch (error) {
		console.error("Failed to refresh MCP servers:", error);
		// On error, just use custom servers
		allMcpServers.set(loadCustomServers());
		mcpServersLoaded.set(true);
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
			// Track if this is a base server being disabled
			if (id.startsWith("base-")) {
				const disabled = loadDisabledBaseIds();
				disabled.add(id);
				saveDisabledBaseIds(disabled);
			}
		} else {
			newSet.add(id);
			// Remove from disabled if re-enabling a base server
			if (id.startsWith("base-")) {
				const disabled = loadDisabledBaseIds();
				disabled.delete(id);
				saveDisabledBaseIds(disabled);
			}
		}
		return newSet;
	});
}

/**
 * Disable all MCP servers (marks all base servers as disabled)
 */
export function disableAllServers() {
	// Get current base server IDs and mark them all as disabled
	const servers = get(allMcpServers);
	const baseServerIds = servers.filter((s) => s.type === "base").map((s) => s.id);

	// Save all base servers as disabled
	saveDisabledBaseIds(new Set(baseServerIds));

	// Clear the selection
	selectedServerIds.set(new Set());
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
 * Build the user-entered headers sent for this server. OAuth credentials are
 * resolved from the opaque connection ID at the server-side request boundary.
 */
export function effectiveServerHeaders(server: MCPServer): KeyValuePair[] {
	return [...(server.headers ?? [])];
}

/**
 * Set / replace the full OAuth state on a custom server (e.g., after the
 * Authorize popup flow completes successfully).
 */
export function setServerOAuth(id: string, oauth: MCPOAuthState) {
	allMcpServers.update(($servers) =>
		$servers.map((s) => ({
			...s,
			...(s.id === id ? { oauth, authRequired: oauth.status !== "authorized" } : {}),
		}))
	);
	persistCustomServers();
}

/**
 * Delete the owner-scoped connection first, then best-effort revoke its token.
 * A fresh discovery is attempted so the server remains re-authorizable.
 */
export async function disconnectServerOAuth(id: string, rediscover = true): Promise<boolean> {
	const server = get(allMcpServers).find((s) => s.id === id);
	if (!server?.oauth) return false;
	const disconnected = await disconnectOAuthConnection(server.oauth.connectionId);
	allMcpServers.update(($servers) =>
		$servers.map((candidate) =>
			candidate.id === id ? { ...candidate, oauth: undefined, authRequired: true } : candidate
		)
	);
	try {
		if (!rediscover) {
			persistCustomServers();
			return disconnected;
		}
		const discovery = await discoverServer(server.url);
		if (discovery.connection) setServerOAuth(id, discovery.connection);
	} catch {
		persistCustomServers();
	}
	return disconnected;
}

function persistCustomServers() {
	const all = get(allMcpServers);
	const customs = all.filter((s) => s.type === "custom");
	saveCustomServers(customs);
}

/**
 * Run health check on a server
 */
export async function healthCheckServer(
	server: MCPServer
): Promise<{ ready: boolean; tools?: MCPTool[]; error?: string }> {
	try {
		updateServerStatus(server.id, "connecting");

		const response = await fetch(`${base}/api/mcp/health`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				url: server.url,
				headers: effectiveServerHeaders(server),
				oauthConnectionId: server.oauth?.connectionId,
			}),
		});

		const result = await response.json();

		if (result.ready && result.tools) {
			if (result.oauth) setServerOAuth(server.id, result.oauth);
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

/**
 * After a full-page redirect OAuth flow returns, consume any handoff payload
 * from the URL hash and apply it to the corresponding server entry.
 */
async function consumeOAuthRedirectIfAny() {
	if (!browser) return;
	const { consumeRedirectHandoff } = await import("$lib/utils/mcpOAuth");
	const result = consumeRedirectHandoff();
	if (!result) return;
	const { payload, serverId } = result;
	if (!payload.ok || !payload.connection) return;
	setServerOAuth(serverId, payload.connection);
	// Mirror the popup path's behavior: auto-enable a freshly-authorized server
	// so its tools ship with the next chat without the user having to flip the
	// switch on the card.
	if (!get(selectedServerIds).has(serverId)) {
		toggleServer(serverId);
	}
}

// Initialize on module load
if (browser) {
	refreshMcpServers().then(() => {
		consumeOAuthRedirectIfAny();
	});
}
