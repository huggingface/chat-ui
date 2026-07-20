/**
 * Fallback title used when no meaningful title can be derived for a
 * conversation — e.g. a reasoning-only model response that stripped down to
 * nothing, or a brand-new conversation awaiting generation.
 *
 * Centralized so the fallback policy lives in one place and is trivial to
 * change (or make context-aware) if review prefers something else.
 */
export function getFallbackTitle(): string {
	return "New Chat";
}
