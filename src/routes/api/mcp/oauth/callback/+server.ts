import type { RequestHandler } from "./$types";
import { logger } from "$lib/server/logger";
import { exchangeCodeForTokens, tokensWithExpiresAt } from "$lib/server/mcp/oauth/exchange";
import { randomBytes } from "crypto";
import { oauthCallbackUri, safeLocalReturnPath } from "$lib/server/mcp/oauth/redirect";
import {
	consumeAuthorizationFlow,
	publicOAuthState,
	revokeConnectionTokens,
	storeAuthorizationTokens,
} from "$lib/server/mcp/oauth/connections";
import { base } from "$app/paths";
import { config } from "$lib/server/config";
import { assertAuthorizationResponseIssuer } from "$lib/server/mcp/oauth/validation";
import type { MCPOAuthState } from "$lib/types/Tool";
import type {
	AuthorizationServerMetadata,
	OAuthClientInformationFull,
} from "@modelcontextprotocol/client";

interface PopupResultMessage {
	ok: boolean;
	flowId: string;
	connection?: MCPOAuthState;
	error?: string;
}

/** JSON-encode for safe embedding in an inline <script>: escapes <, >, &, and the U+2028/U+2029 line separators. */
function jsonForInlineScript(value: unknown): string {
	return JSON.stringify(value)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026")
		.replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function popupResponse(origin: string, message: PopupResultMessage): Response {
	const json = jsonForInlineScript(message);
	const appName = escapeHtml(config.PUBLIC_APP_NAME || "chat-ui");
	const nonce = randomBytes(18).toString("base64");
	const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Authorization complete</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { font-family: system-ui, sans-serif; padding: 24px; color: #1f2937; background: #f9fafb; }
  .card { max-width: 400px; margin: 60px auto; padding: 24px; border-radius: 12px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.08); text-align: center; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  p { font-size: 14px; color: #4b5563; margin: 0; }
</style>
</head>
<body>
  <div class="card">
    <h1>${message.ok ? "Authorization complete" : "Authorization failed"}</h1>
    ${message.error ? `<p>${escapeHtml(message.error)}</p>` : ""}
    <p id="close-hint">You can close this window.</p>
    <p id="return-link" hidden><a href="${escapeHtml(`${base}/`)}">Return to ${appName}</a></p>
  </div>
  <script nonce="${nonce}">
    (function () {
      var msg = ${json};
      // No opener: either a popup whose opener was severed (COOP) or the main tab of a full-page
      // flow whose state is gone. close() only works for the former; the link covers the latter.
      if (!window.opener) {
        document.getElementById("close-hint").hidden = true;
        document.getElementById("return-link").hidden = false;
        try { window.close(); } catch (e) {}
        return;
      }
      try {
        if (window.opener) {
          window.opener.postMessage({ type: "mcp-oauth-result", payload: msg }, ${jsonForInlineScript(
						origin
					)});
        }
      } catch (e) {}
      try { window.close(); } catch (e) {}
    })();
  </script>
</body>
</html>`;
	return new Response(body, {
		status: 200,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy": "no-referrer",
			"Content-Security-Policy":
				`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; ` +
				"img-src 'none'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none';",
		},
	});
}

function redirectResponseWithHash(redirectNext: string, message: PopupResultMessage): Response {
	const safePath = safeLocalReturnPath(redirectNext);
	const handoff = Buffer.from(JSON.stringify(message), "utf8").toString("base64url");
	const fragment = `#__mcp_oauth_handoff=${handoff}`;
	return new Response(null, {
		status: 302,
		headers: {
			Location: safePath + fragment,
			"Cache-Control": "no-store",
		},
	});
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const errorParam = url.searchParams.get("error");
	const errorDescription = url.searchParams.get("error_description");

	let callbackUri: string;
	try {
		callbackUri = oauthCallbackUri(url);
	} catch {
		callbackUri = url.origin + url.pathname;
	}

	const origin = new URL(callbackUri).origin;
	const connection = state
		? await consumeAuthorizationFlow(locals, state, callbackUri).catch(() => null)
		: null;
	const flow = connection?.flow;
	const popupMode = flow?.popupMode ?? true;
	const redirectNext = flow?.redirectNext;

	const respond = (message: PopupResultMessage) => {
		if (!popupMode && redirectNext) {
			return redirectResponseWithHash(redirectNext, message);
		}
		return popupResponse(origin, { ...message });
	};

	if (errorParam) {
		return respond({
			ok: false,
			flowId: flow?.id ?? "",
			error: `${errorParam}${errorDescription ? `: ${errorDescription}` : ""}`,
		});
	}

	if (!connection || !flow) {
		return respond({
			ok: false,
			flowId: "",
			error: "Authorization flow expired or invalid",
		});
	}

	if (!code || !state) {
		return respond({
			ok: false,
			flowId: flow.id,
			error: "Missing code/state in callback",
		});
	}

	if (state !== flow.expectedState) {
		return respond({
			ok: false,
			flowId: flow.id,
			error: "State mismatch (CSRF protection)",
		});
	}

	try {
		assertAuthorizationResponseIssuer(
			url.searchParams.get("iss"),
			connection.asMetadata as unknown as AuthorizationServerMetadata
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Issuer validation failed";
		logger.warn(
			{ err: msg, flowId: flow.id },
			"[mcp-oauth] rejected authorization response issuer"
		);
		return respond({
			ok: false,
			flowId: flow.id,
			error: "Authorization server mismatch",
		});
	}

	let tokens: ReturnType<typeof tokensWithExpiresAt>;
	try {
		tokens = tokensWithExpiresAt(
			await exchangeCodeForTokens({
				asMetadata: connection.asMetadata as unknown as AuthorizationServerMetadata,
				clientInfo: connection.clientInfo as unknown as OAuthClientInformationFull,
				redirectUri: flow.redirectUri,
				resource: connection.resource,
				code,
				codeVerifier: flow.verifier,
				iss: url.searchParams.get("iss") ?? undefined,
			})
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Token exchange failed";
		logger.warn({ err: msg, flowId: flow.id }, "[mcp-oauth] code exchange failed");
		return respond({ ok: false, flowId: flow.id, error: "Token exchange failed" });
	}

	try {
		const updated = await storeAuthorizationTokens(locals, connection, tokens);
		return respond({
			ok: true,
			flowId: flow.id,
			connection: publicOAuthState(updated),
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Could not save authorization";
		logger.warn({ err: msg, flowId: flow.id }, "[mcp-oauth] storing tokens failed");
		// The grant exists at the AS but nowhere we can reach it again; don't leave it live.
		await revokeConnectionTokens({ ...connection, tokens }).catch(() => false);
		return respond({ ok: false, flowId: flow.id, error: "Could not save authorization" });
	}
};

// We don't request `response_mode=form_post` from `startAuthorization`, so
// authorization servers always return code/state via the query string on a GET.
// Intentionally not exporting POST — aliasing it to GET would silently fail to
// read code/state from the form body for any AS that decides to POST anyway.
