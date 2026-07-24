import { base } from "$app/paths";
import type { RequestHandler } from "./$types";
import { logger } from "$lib/server/logger";
import { exchangeCodeForTokens, tokensWithExpiresAt } from "$lib/server/mcp/oauth/exchange";
import { FLOW_COOKIE_NAME, verifyFlowCookie } from "$lib/server/mcp/oauth/state";
import { config } from "$lib/server/config";
import { dev } from "$app/environment";
import { randomBytes } from "crypto";
import { oauthCallbackUri, safeLocalReturnPath } from "$lib/server/mcp/oauth/redirect";
import type {
	AuthorizationServerMetadata,
	OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js";

interface PopupResultMessage {
	ok: boolean;
	flowId: string;
	tokens?: unknown;
	resource?: string;
	error?: string;
}

const sameSite = "lax" as const;
const secure = !(dev || config.ALLOW_INSECURE_COOKIES === "true");

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

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const errorParam = url.searchParams.get("error");
	const errorDescription = url.searchParams.get("error_description");

	// Locate only the cookie cryptographically bound to the returned state.
	// Never fall back to an unrelated flow when state is missing or mismatched.
	const flowCookies = cookies.getAll().filter((c) => c.name.startsWith(`${FLOW_COOKIE_NAME}-`));
	let cookieFlowId: string | undefined;
	let flowState = null as ReturnType<typeof verifyFlowCookie>;
	for (const c of flowCookies) {
		const candidate = verifyFlowCookie(c.value, locals.sessionId);
		const candidateFlowId = c.name.slice(`${FLOW_COOKIE_NAME}-`.length);
		if (candidate && candidate.flowId === candidateFlowId && candidate.expectedState === state) {
			cookieFlowId = candidateFlowId;
			flowState = candidate;
			break;
		}
	}

	let callbackUri: string;
	try {
		callbackUri = oauthCallbackUri(url);
	} catch {
		callbackUri = url.origin + url.pathname;
		flowState = null;
		cookieFlowId = undefined;
	}
	if (flowState?.redirectUri !== callbackUri) {
		flowState = null;
		cookieFlowId = undefined;
	}

	const origin = new URL(callbackUri).origin;
	const popupMode = flowState?.popupMode ?? true;
	const redirectNext = flowState?.redirectNext;

	const expireFlowCookie = () => {
		if (!cookieFlowId) return;
		cookies.set(`${FLOW_COOKIE_NAME}-${cookieFlowId}`, "", {
			path: `${base}/api/mcp/oauth`,
			httpOnly: true,
			sameSite,
			secure,
			maxAge: 0,
		});
	};

	const respond = (message: PopupResultMessage) => {
		expireFlowCookie();
		if (!popupMode && redirectNext) {
			return redirectResponseWithHash(redirectNext, message);
		}
		return popupResponse(origin, { ...message });
	};

	if (errorParam) {
		return respond({
			ok: false,
			flowId: flowState?.flowId ?? "",
			error: `${errorParam}${errorDescription ? `: ${errorDescription}` : ""}`,
		});
	}

	if (!flowState) {
		return respond({
			ok: false,
			flowId: "",
			error: "Authorization flow expired or invalid",
		});
	}

	if (!code || !state) {
		return respond({
			ok: false,
			flowId: flowState.flowId,
			error: "Missing code/state in callback",
		});
	}

	if (state !== flowState.expectedState) {
		return respond({
			ok: false,
			flowId: flowState.flowId,
			error: "State mismatch (CSRF protection)",
		});
	}

	try {
		const tokens = await exchangeCodeForTokens({
			asMetadata: flowState.asMetadata as unknown as AuthorizationServerMetadata,
			clientInfo: flowState.clientInfo as unknown as OAuthClientInformationFull,
			redirectUri: flowState.redirectUri,
			resource: flowState.resource,
			code,
			codeVerifier: flowState.verifier,
		});
		return respond({
			ok: true,
			flowId: flowState.flowId,
			tokens: tokensWithExpiresAt(tokens),
			resource: flowState.resource,
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Token exchange failed";
		logger.warn({ err: msg, flowId: flowState.flowId }, "[mcp-oauth] code exchange failed");
		return respond({ ok: false, flowId: flowState.flowId, error: msg });
	}
};

// We don't request `response_mode=form_post` from `startAuthorization`, so
// authorization servers always return code/state via the query string on a GET.
// Intentionally not exporting POST — aliasing it to GET would silently fail to
// read code/state from the form body for any AS that decides to POST anyway.
