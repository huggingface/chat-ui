// Lightweight browser OAuth client provider compatible with the MCP SDK
// Inspired by ../use-mcp BrowserOAuthClientProvider but without extra deps

import type {
	OAuthClientInformation,
	OAuthTokens,
	OAuthClientMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { browser } from "$app/environment";
import type { StoredState } from "./types";

function sanitizeUrl(input: string): string {
	try {
		const url = new URL(input);
		return url.toString();
	} catch {
		return input;
	}
}

// Generate cryptographically-strong random state for OAuth
function randomState(len = 32): string {
	const a = new Uint8Array(len);
	// Web Crypto API (available in modern browsers)
	crypto.getRandomValues(a);
	return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class BrowserOAuthClientProvider implements OAuthClientProvider {
	readonly serverUrl: string;
	readonly storageKeyPrefix: string;
	readonly serverUrlHash: string;
	readonly clientName: string;
	readonly clientUri: string;
	readonly callbackUrl: string;
	private preventAutoAuth?: boolean;
	readonly onPopupWindow: ((url: string, features: string, win: Window | null) => void) | undefined;

	constructor(
		serverUrl: string,
		options: {
			storageKeyPrefix?: string;
			clientName?: string;
			clientUri?: string;
			callbackUrl?: string;
			preventAutoAuth?: boolean;
			onPopupWindow?: (url: string, features: string, win: Window | null) => void;
		} = {}
	) {
		this.serverUrl = serverUrl;
		this.storageKeyPrefix = options.storageKeyPrefix || "mcp:auth";
		this.serverUrlHash = this.hashString(serverUrl);
		this.clientName = options.clientName || "chat-ui";
		this.clientUri = options.clientUri || (browser ? window.location.origin : "");
		this.callbackUrl = sanitizeUrl(
			options.callbackUrl ||
				(browser
					? new URL("/oauth/callback", window.location.origin).toString()
					: "/oauth/callback")
		);
		this.preventAutoAuth = options.preventAutoAuth;
		this.onPopupWindow = options.onPopupWindow;
	}

	get redirectUrl(): string {
		return sanitizeUrl(this.callbackUrl);
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			redirect_uris: [this.redirectUrl],
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			client_name: this.clientName,
			client_uri: this.clientUri,
		};
	}

	async clientInformation(): Promise<OAuthClientInformation | undefined> {
		const data = browser ? localStorage.getItem(this.getKey("client_info")) : null;
		if (!data) return undefined;
		try {
			return JSON.parse(data) as OAuthClientInformation;
		} catch {
			localStorage.removeItem(this.getKey("client_info"));
			return undefined;
		}
	}

	async saveClientInformation(info: OAuthClientInformation): Promise<void> {
		if (!browser) return;
		localStorage.setItem(this.getKey("client_info"), JSON.stringify(info));
	}

	async tokens(): Promise<OAuthTokens | undefined> {
		const data = browser ? localStorage.getItem(this.getKey("tokens")) : null;
		if (!data) return undefined;
		try {
			return JSON.parse(data) as OAuthTokens;
		} catch {
			localStorage.removeItem(this.getKey("tokens"));
			return undefined;
		}
	}

	async saveTokens(tokens: OAuthTokens): Promise<void> {
		if (!browser) return;
		localStorage.setItem(this.getKey("tokens"), JSON.stringify(tokens));
		localStorage.removeItem(this.getKey("code_verifier"));
		localStorage.removeItem(this.getKey("last_auth_url"));
	}

	async saveCodeVerifier(verifier: string): Promise<void> {
		if (!browser) return;
		localStorage.setItem(this.getKey("code_verifier"), verifier);
	}

	async codeVerifier(): Promise<string> {
		const v = browser ? localStorage.getItem(this.getKey("code_verifier")) : null;
		if (!v) throw new Error("Code verifier not found");
		return v;
	}

	async prepareAuthorizationUrl(authorizationUrl: URL): Promise<string> {
		if (!browser) return authorizationUrl.toString();
		const state = randomState();
		const stateKey = `${this.storageKeyPrefix}:state_${state}`;
		const expiry = Date.now() + 5 * 60 * 1000;
		const stored: StoredState = {
			expiry,
			serverUrlHash: this.serverUrlHash,
			providerOptions: {
				serverUrl: this.serverUrl,
				storageKeyPrefix: this.storageKeyPrefix,
				clientName: this.clientName,
				clientUri: this.clientUri,
				callbackUrl: this.callbackUrl,
			},
		};
		localStorage.setItem(stateKey, JSON.stringify(stored));
		authorizationUrl.searchParams.set("state", state);
		const full = authorizationUrl.toString();
		const sanitized = sanitizeUrl(full);
		localStorage.setItem(this.getKey("last_auth_url"), sanitized);
		return sanitized;
	}

	async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
		if (this.preventAutoAuth || !browser) return;
		const url = await this.prepareAuthorizationUrl(authorizationUrl);
		const features = "width=600,height=700,resizable=yes,scrollbars=yes,status=yes";
		try {
			const win = window.open(url, `mcp_auth_${this.serverUrlHash}`, features);
			this.onPopupWindow?.(url, features, win);
			if (!win || win.closed) console.warn("[mcp] popup may be blocked");
		} catch (e) {
			console.error("[mcp] failed to open popup", e);
		}
	}

	getLastAttemptedAuthUrl(): string | null {
		if (!browser) return null;
		const v = localStorage.getItem(this.getKey("last_auth_url"));
		return v ? sanitizeUrl(v) : null;
	}

	clearStorage(): number {
		if (!browser) return 0;
		const prefix = `${this.storageKeyPrefix}_${this.serverUrlHash}_`;
		const statePrefix = `${this.storageKeyPrefix}:state_`;
		const toRemove: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (!k) continue;
			if (k.startsWith(prefix)) toRemove.push(k);
			if (k.startsWith(statePrefix)) {
				try {
					const raw = localStorage.getItem(k);
					if (!raw) continue;
					const parsed = JSON.parse(raw) as Partial<StoredState>;
					if (parsed.serverUrlHash === this.serverUrlHash) toRemove.push(k);
				} catch {}
			}
		}
		const unique = [...new Set(toRemove)];
		unique.forEach((k) => localStorage.removeItem(k));
		return unique.length;
	}

	getKey(suffix: string): string {
		return `${this.storageKeyPrefix}_${this.serverUrlHash}_${suffix}`;
	}

	private hashString(str: string): string {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			hash = (hash << 5) - hash + str.charCodeAt(i);
			hash |= 0;
		}
		return Math.abs(hash).toString(16);
	}
}
