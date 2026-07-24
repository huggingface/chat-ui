import type { RequestHandler } from "./$types";
import { logger } from "$lib/server/logger";
import { exchangeCodeForTokens, tokensWithExpiresAt } from "$lib/server/mcp/oauth/exchange";
import { randomBytes } from "crypto";
import { oauthCallbackUri, safeLocalReturnPath } from "$lib/server/mcp/oauth/redirect";
import {
	consumeAuthorizationFlow,
	publicOAuthState,
	storeAuthorizationTokens,
} from "$lib/server/mcp/oauth/connections";
import type { MCPOAuthState } from "$lib/types/Tool";
import type {
	AuthorizationServerMetadata,
	OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js";

interface PopupResultMessage {
	ok: boolean;
	flowId: string;
	connection?: MCPOAuthState;
	error?: string;
}

/**
 * Encode a value as JSON safe to embed inside an inline `<script>` tag. Escapes
 * the four sequences that can break out of or be reinterpreted by the HTML
 * parser before JavaScript sees the literal: `<`, `>`, `&`, and the U+2028 /
 * U+2029 line separators (which JS treats as line terminators in string
 * literals starting with ES2019, but historically broke parsers).
 */
function jsonForInlineScript(value: unknown): string {
	return JSON.stringify(value)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026")
		.replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function popupResponse(origin: string, message: PopupResultMessage): Response {
	const json = jsonForInlineScript(message);
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
    <p>You can close this window.</p>
  </div>
  <script nonce="${nonce}">
    (function () {
      var msg = ${json};
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
		const tokens = await exchangeCodeForTokens({
			asMetadata: connection.asMetadata as unknown as AuthorizationServerMetadata,
			clientInfo: connection.clientInfo as unknown as OAuthClientInformationFull,
			redirectUri: flow.redirectUri,
			resource: connection.resource,
			code,
			codeVerifier: flow.verifier,
		});
		const updated = await storeAuthorizationTokens(locals, connection, tokensWithExpiresAt(tokens));
		return respond({
			ok: true,
			flowId: flow.id,
			connection: publicOAuthState(updated),
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Token exchange failed";
		logger.warn({ err: msg, flowId: flow.id }, "[mcp-oauth] code exchange failed");
		return respond({ ok: false, flowId: flow.id, error: "Token exchange failed" });
	}
};

// We don't request `response_mode=form_post` from `startAuthorization`, so
// authorization servers always return code/state via the query string on a GET.
// Intentionally not exporting POST — aliasing it to GET would silently fail to
// read code/state from the form body for any AS that decides to POST anyway.
