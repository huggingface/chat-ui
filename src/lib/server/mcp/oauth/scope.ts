const MAX_SCOPE_LENGTH = 2048;
const MAX_SCOPE_COUNT = 50;
const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

export function normalizeOAuthScope(scope: string | undefined): string | undefined {
	if (!scope) return undefined;
	if (scope.length > MAX_SCOPE_LENGTH) throw new Error("OAuth scope challenge is too large");
	const tokens = [...new Set(scope.trim().split(/\s+/).filter(Boolean))];
	if (tokens.length > MAX_SCOPE_COUNT || tokens.some((token) => !SCOPE_TOKEN.test(token))) {
		throw new Error("OAuth scope challenge is invalid");
	}
	return tokens.length ? tokens.join(" ") : undefined;
}

export function selectInitialOAuthScope(
	challengeScope: string | undefined,
	protectedResourceScopes: string[] | undefined
): string | undefined {
	if (challengeScope) return normalizeOAuthScope(challengeScope);
	if (!protectedResourceScopes?.length) return undefined;
	return normalizeOAuthScope(protectedResourceScopes.join(" "));
}

export function mergeOAuthScopes(...scopes: Array<string | undefined>): string | undefined {
	return normalizeOAuthScope(scopes.filter(Boolean).join(" "));
}
