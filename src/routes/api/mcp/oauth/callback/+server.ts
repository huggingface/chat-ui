import { base } from "$app/paths";
import type { RequestHandler } from "./$types";
import { logger } from "$lib/server/logger";
import { exchangeCodeForTokens, tokensWithExpiresAt } from "$lib/server/mcp/oauth/exchange";
import { FLOW_COOKIE_NAME, verifyFlowCookie } from "$lib/server/mcp/oauth/state";
import { config } from "$lib/server/config";
import { dev } from "$app/environment";
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

const sameSite = config.ALLOW_INSECURE_COOKIES === "true" || dev ? "lax" : ("none" as const);
const secure = !(dev || config.ALLOW_INSECURE_COOKIES === "true");

function htmlEscape(s: string): string {
	return s.replace(/[&<>"']/g, (c) => {
		switch (c) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			case "'":
				return "&#39;";
		}
		return c;
	});
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
  <script>
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
			// Hardening: tighten CSP so the inline bootstrap is the only script that runs.
			"Content-Security-Policy":
				"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; frame-ancestors 'none';",
		},
	});
}

function safeReturnPath(input: string | undefined): string {
	if (!input || typeof input !== "string") return "/";
	if (input.startsWith("//")) return "/";
	if (!input.startsWith("/")) return "/";
	return input;
}

function redirectResponseWithHash(redirectNext: string, message: PopupResultMessage): Response {
	const safePath = safeReturnPath(redirectNext);
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

export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const errorParam = url.searchParams.get("error");
	const errorDescription = url.searchParams.get("error_description");

	// Find the most recent flow cookie. We do this with cookies.getAll() so we
	// don't depend on a specific flowId being present in the URL — the AS
	// callback only carries `code` and `state`.
	const flowCookies = cookies.getAll().filter((c) => c.name.startsWith(`${FLOW_COOKIE_NAME}-`));
	let cookieFlowId: string | undefined;
	let flowState = null as ReturnType<typeof verifyFlowCookie>;
	for (const c of flowCookies) {
		const candidate = verifyFlowCookie(c.value);
		if (candidate && candidate.expectedState === state) {
			cookieFlowId = c.name.slice(`${FLOW_COOKIE_NAME}-`.length);
			flowState = candidate;
			break;
		}
	}
	// Fallback for the error path (state mismatch / no state at all): take the
	// first valid cookie so we know how to render (popup vs redirect).
	if (!flowState) {
		for (const c of flowCookies) {
			const candidate = verifyFlowCookie(c.value);
			if (candidate) {
				cookieFlowId = c.name.slice(`${FLOW_COOKIE_NAME}-`.length);
				flowState = candidate;
				break;
			}
		}
	}

	const origin = config.PUBLIC_ORIGIN || url.origin;
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
			error: htmlEscape(`${errorParam}${errorDescription ? `: ${errorDescription}` : ""}`),
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
