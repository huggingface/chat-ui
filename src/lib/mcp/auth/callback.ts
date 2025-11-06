import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { BrowserOAuthClientProvider } from "./browserProvider";
import type { StoredState } from "./types";

export async function onMcpAuthorization() {
	const params = new URLSearchParams(window.location.search);
	const code = params.get("code");
	const state = params.get("state");
	const error = params.get("error");
	const desc = params.get("error_description");

	let provider: BrowserOAuthClientProvider | null = null;
	const stateKey = state ? `mcp:auth:state_${state}` : null;
	try {
		if (error) throw new Error(`OAuth error: ${error} ${desc ?? ""}`);
		if (!code) throw new Error("Missing authorization code");
		if (!state || !stateKey) throw new Error("Missing state");

		const raw = localStorage.getItem(stateKey);
		if (!raw) throw new Error("Invalid or expired state");
		const stored = JSON.parse(raw) as StoredState;
		if (!stored.expiry || stored.expiry < Date.now()) {
			localStorage.removeItem(stateKey);
			throw new Error("State expired");
		}
		const { serverUrl, ...providerOptions } = stored.providerOptions;
		provider = new BrowserOAuthClientProvider(serverUrl, providerOptions);

		const result = await auth(provider, { serverUrl, authorizationCode: code });
		if (result !== "AUTHORIZED") throw new Error(`Unexpected auth result: ${result}`);

		if (window.opener && !window.opener.closed) {
			window.opener.postMessage(
				{ type: "mcp_auth_callback", success: true },
				window.location.origin
			);
			localStorage.removeItem(stateKey);
			window.close();
			return;
		}
		// Fallback navigation
		localStorage.removeItem(stateKey);
		try {
			const { base } = await import("$app/paths");
			window.location.assign(base || "/");
		} catch {
			window.location.assign("/");
		}
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		console.error("[mcp-callback] error", e);
		if (window.opener && !window.opener.closed) {
			window.opener.postMessage(
				{ type: "mcp_auth_callback", success: false, error: message },
				window.location.origin
			);
		}
		try {
			document.body.innerHTML = `<div style="font-family:sans-serif;padding:16px"><h1>Authentication Error</h1><p style="color:#b91c1c">${message}</p><button onclick="window.close()">Close</button></div>`;
		} catch {}
		if (stateKey) localStorage.removeItem(stateKey);
		if (provider) {
			localStorage.removeItem(provider.getKey("code_verifier"));
			localStorage.removeItem(provider.getKey("last_auth_url"));
		}
	}
}
