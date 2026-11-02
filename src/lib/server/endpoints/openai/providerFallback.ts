import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { providerMaxTokensCap, type CappedModel } from "$lib/server/providerLimits";
import { withoutContentLength } from "$lib/server/undiciCompat";

/** statuses a provider gives while throttled or down, the same request can go elsewhere */
const UNAVAILABLE = new Set([429, 502, 503, 504]);

/**
 * Sends a completion request, every caller goes through here so the provider limits hold on all of them.
 * max_tokens is capped to the limit of the provider the model suffix names, or the lowest one when the
 * router picks. A pinned provider is retried once on auto when it 402s, the router 402s billing disabled
 * providers even for users with credits, and when a default pin (nobody picked it) is throttled or down.
 * Other backends use colons in model ids, so the retries are HuggingChat only.
 */
export async function fetchWithProviderFallback(
	input: RequestInfo | URL,
	init?: RequestInit,
	model: CappedModel = {},
	{ defaultPin = false }: { defaultPin?: boolean } = {}
): Promise<Response> {
	const sent = withProviderCap(init, model);
	const res = await fetch(input, withoutContentLength(sent));
	const fallback = res.status === 402 || (defaultPin && UNAVAILABLE.has(res.status));
	if (!fallback || !config.isHuggingChat || typeof sent?.body !== "string") return res;
	const retry = withoutProviderSuffix(sent.body, providerMaxTokensCap(model, undefined));
	if (!retry) return res;
	logger.warn(
		{
			model: retry.model,
			provider: retry.provider,
			status: res.status,
			errorCode: res.headers.get("x-error-code") ?? undefined,
		},
		"[inference] pinned provider refused the request; retrying on auto"
	);
	await res.body?.cancel().catch(() => {});
	return fetch(input, withoutContentLength({ ...sent, body: retry.body }));
}

function withProviderCap(
	init: RequestInit | undefined,
	model: CappedModel
): RequestInit | undefined {
	if (!model.providerMaxTokens || typeof init?.body !== "string") return init;
	const parsed = parseBody(init.body);
	if (!parsed) return init;
	const { provider } = splitModel(parsed.model);
	const capped = capTokens(parsed, providerMaxTokensCap(model, provider));
	return capped === parsed ? init : { ...init, body: JSON.stringify(capped) };
}

function withoutProviderSuffix(
	body: string,
	maxTokens: number | undefined
): { body: string; model: string; provider: string } | undefined {
	const parsed = parseBody(body);
	if (!parsed) return undefined;
	const { bare, provider } = splitModel(parsed.model);
	if (!provider) return undefined;
	return {
		body: JSON.stringify(capTokens({ ...parsed, model: bare }, maxTokens)),
		model: bare,
		provider,
	};
}

function parseBody(body: string): Record<string, unknown> | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
	return parsed as Record<string, unknown>;
}

function splitModel(model: unknown): { bare: string; provider?: string } {
	if (typeof model !== "string") return { bare: "" };
	const sep = model.lastIndexOf(":");
	if (sep <= 0 || sep === model.length - 1) return { bare: model };
	return { bare: model.slice(0, sep), provider: model.slice(sep + 1) };
}

/** the same object when nothing was over the cap */
function capTokens(
	body: Record<string, unknown>,
	maxTokens: number | undefined
): Record<string, unknown> {
	if (maxTokens === undefined) return body;
	let capped = body;
	for (const key of ["max_tokens", "max_completion_tokens"]) {
		const value = body[key];
		if (typeof value === "number" && value > maxTokens) capped = { ...capped, [key]: maxTokens };
	}
	return capped;
}

export function upstreamErrorCode(err: unknown): string | undefined {
	if (!err || typeof err !== "object") return undefined;
	const { errorCode, headers } = err as { errorCode?: unknown; headers?: unknown };
	if (typeof errorCode === "string") return errorCode;
	const code =
		headers instanceof Headers
			? headers.get("x-error-code")
			: headers && typeof headers === "object"
				? (headers as Record<string, unknown>)["x-error-code"]
				: undefined;
	return typeof code === "string" && code ? code : undefined;
}
