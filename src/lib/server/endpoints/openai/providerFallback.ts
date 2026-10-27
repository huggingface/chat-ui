import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { withoutContentLength } from "$lib/server/undiciCompat";

/** retries a 402 on a pinned provider once on auto, the router 402s billing disabled providers even for users with credits, other backends use colons in model ids */
export async function fetchWithProviderFallback(
	input: RequestInfo | URL,
	init?: RequestInit
): Promise<Response> {
	const res = await fetch(input, withoutContentLength(init));
	if (res.status !== 402 || !config.isHuggingChat || typeof init?.body !== "string") return res;
	const retry = withoutProviderSuffix(init.body);
	if (!retry) return res;
	logger.warn(
		{
			model: retry.model,
			provider: retry.provider,
			errorCode: res.headers.get("x-error-code") ?? undefined,
		},
		"[inference] pinned provider refused with 402; retrying on auto"
	);
	await res.body?.cancel().catch(() => {});
	return fetch(input, withoutContentLength({ ...init, body: retry.body }));
}

function withoutProviderSuffix(
	body: string
): { body: string; model: string; provider: string } | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object") return undefined;
	const model = (parsed as { model?: unknown }).model;
	if (typeof model !== "string") return undefined;
	const sep = model.lastIndexOf(":");
	if (sep <= 0 || sep === model.length - 1) return undefined;
	const bare = model.slice(0, sep);
	return {
		body: JSON.stringify({ ...parsed, model: bare }),
		model: bare,
		provider: model.slice(sep + 1),
	};
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
