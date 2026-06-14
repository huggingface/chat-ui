const MAX_PARAM_LENGTH = 10_000;

export function sanitizeUrlParam(value: string | null): string | null {
	if (value == null) return null;

	const trimmed = value.trim();
	if (!trimmed.length) return null;
	if (trimmed.length > MAX_PARAM_LENGTH) return null;

	return trimmed;
}

/**
 * Resolve the user prompt carried by a home-page deep link. `?q=` (auto-sent)
 * takes precedence over `?prompt=` (prefilled draft), matching how the home
 * page consumes them in onMount. Returns the sanitized text, or "" when neither
 * param holds usable text. Drives the social-preview tags + thumbnail so that
 * sharing a `?q=`/`?prompt=` link unfurls with the prompt instead of the
 * generic app card.
 */
export function promptFromLinkParams(params: URLSearchParams): string {
	return sanitizeUrlParam(params.get("q")) ?? sanitizeUrlParam(params.get("prompt")) ?? "";
}

export { MAX_PARAM_LENGTH };
