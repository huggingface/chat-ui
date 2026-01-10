/**
 * MCP OAuth Token Store
 * Manages OAuth tokens and flow state in localStorage
 */

import { writable, get } from "svelte/store";
import { browser } from "$app/environment";
import { env as publicEnv } from "$env/dynamic/public";
import type { McpOAuthToken, McpOAuthFlowState, McpOAuthConfig } from "$lib/types/McpOAuth";

// Match the key prefix pattern from mcpServers.ts
function toKeyPart(s: string | undefined): string {
	return (s || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

const appLabel = toKeyPart(publicEnv.PUBLIC_APP_ASSETS || publicEnv.PUBLIC_APP_NAME);
const KEY_PREFIX = appLabel || "app";

const STORAGE_KEYS = {
	OAUTH_TOKENS: `${KEY_PREFIX}:mcp:oauth-tokens`,
	OAUTH_CONFIGS: `${KEY_PREFIX}:mcp:oauth-configs`,
	OAUTH_FLOW: `${KEY_PREFIX}:mcp:oauth-flow`,
} as const;

// Token expiry buffer: consider expired 5 minutes before actual expiry
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
// Near expiry warning: 10 minutes before expiry
const NEAR_EXPIRY_MS = 10 * 60 * 1000;

function loadTokens(): Map<string, McpOAuthToken> {
	if (!browser) return new Map();

	try {
		const json = localStorage.getItem(STORAGE_KEYS.OAUTH_TOKENS);
		if (!json) return new Map();
		const obj = JSON.parse(json) as Record<string, McpOAuthToken>;
		return new Map(Object.entries(obj));
	} catch (error) {
		console.error("Failed to load MCP OAuth tokens:", error);
		return new Map();
	}
}

function saveTokens(tokens: Map<string, McpOAuthToken>) {
	if (!browser) return;

	try {
		const obj = Object.fromEntries(tokens);
		localStorage.setItem(STORAGE_KEYS.OAUTH_TOKENS, JSON.stringify(obj));
	} catch (error) {
		console.error("Failed to save MCP OAuth tokens:", error);
	}
}

function loadConfigs(): Map<string, McpOAuthConfig> {
	if (!browser) return new Map();

	try {
		const json = localStorage.getItem(STORAGE_KEYS.OAUTH_CONFIGS);
		if (!json) return new Map();
		const obj = JSON.parse(json) as Record<string, McpOAuthConfig>;
		return new Map(Object.entries(obj));
	} catch (error) {
		console.error("Failed to load MCP OAuth configs:", error);
		return new Map();
	}
}

function saveConfigs(configs: Map<string, McpOAuthConfig>) {
	if (!browser) return;

	try {
		const obj = Object.fromEntries(configs);
		localStorage.setItem(STORAGE_KEYS.OAUTH_CONFIGS, JSON.stringify(obj));
	} catch (error) {
		console.error("Failed to save MCP OAuth configs:", error);
	}
}

// Svelte stores
export const mcpOAuthTokens = writable<Map<string, McpOAuthToken>>(loadTokens());
export const mcpOAuthConfigs = writable<Map<string, McpOAuthConfig>>(loadConfigs());
export const mcpOAuthFlowState = writable<McpOAuthFlowState | null>(null);

// Auto-persist tokens when they change
if (browser) {
	mcpOAuthTokens.subscribe(saveTokens);
	mcpOAuthConfigs.subscribe(saveConfigs);
}

export function saveFlowState(state: McpOAuthFlowState) {
	if (!browser) return;

	try {
		localStorage.setItem(STORAGE_KEYS.OAUTH_FLOW, JSON.stringify(state));
		mcpOAuthFlowState.set(state);
	} catch (error) {
		console.error("Failed to save OAuth flow state:", error);
	}
}

export function loadFlowState(): McpOAuthFlowState | null {
	if (!browser) return null;

	try {
		const json = localStorage.getItem(STORAGE_KEYS.OAUTH_FLOW);
		if (!json) return null;
		const state = JSON.parse(json) as McpOAuthFlowState;
		mcpOAuthFlowState.set(state);
		return state;
	} catch (error) {
		console.error("Failed to load OAuth flow state:", error);
		return null;
	}
}

export function clearFlowState() {
	if (!browser) return;

	try {
		localStorage.removeItem(STORAGE_KEYS.OAUTH_FLOW);
		mcpOAuthFlowState.set(null);
	} catch (error) {
		console.error("Failed to clear OAuth flow state:", error);
	}
}

export function setToken(serverId: string, token: McpOAuthToken) {
	mcpOAuthTokens.update((tokens) => {
		tokens.set(serverId, token);
		return new Map(tokens);
	});
}

export function getToken(serverId: string): McpOAuthToken | undefined {
	return get(mcpOAuthTokens).get(serverId);
}

export function removeToken(serverId: string) {
	mcpOAuthTokens.update((tokens) => {
		tokens.delete(serverId);
		return new Map(tokens);
	});
}

export function setOAuthConfig(serverId: string, config: McpOAuthConfig) {
	mcpOAuthConfigs.update((configs) => {
		configs.set(serverId, config);
		return new Map(configs);
	});
}

export function getOAuthConfig(serverId: string): McpOAuthConfig | undefined {
	return get(mcpOAuthConfigs).get(serverId);
}

export function removeOAuthConfig(serverId: string) {
	mcpOAuthConfigs.update((configs) => {
		configs.delete(serverId);
		return new Map(configs);
	});
}

export function isTokenExpired(token: McpOAuthToken): boolean {
	return Date.now() > token.expiresAt - EXPIRY_BUFFER_MS;
}

export function isTokenNearExpiry(token: McpOAuthToken): boolean {
	return Date.now() > token.expiresAt - NEAR_EXPIRY_MS;
}

export function getTokenStatus(
	serverId: string
): "none" | "valid" | "expiring" | "expired" | "missing" {
	const config = getOAuthConfig(serverId);
	if (!config) return "none"; // Server doesn't use OAuth

	const token = getToken(serverId);
	if (!token) return "missing";
	if (isTokenExpired(token)) return "expired";
	if (isTokenNearExpiry(token)) return "expiring";
	return "valid";
}

export function cleanupServerOAuth(serverId: string) {
	removeToken(serverId);
	removeOAuthConfig(serverId);
}

// Sync stores from localStorage after OAuth popup completes
export function reloadFromStorage() {
	if (!browser) return;

	mcpOAuthTokens.set(loadTokens());
	mcpOAuthConfigs.set(loadConfigs());
}
