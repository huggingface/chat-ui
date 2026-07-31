/**
 * Decode the `arguments` string of a streamed tool call.
 *
 * `null` means the string is unusable — most often a response truncated mid-object.
 * Callers must fail the call rather than substituting `{}`, which would run the tool
 * with no arguments at all. Only an absent or empty string is a real "no arguments".
 */
export function parseToolArguments(raw: unknown): Record<string, unknown> | null {
	if (raw === undefined || raw === null) return {};
	if (typeof raw !== "string") return null;
	if (raw.trim().length === 0) return {};

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}

	// An array or scalar would be dropped downstream and read as "no arguments".
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
	return parsed as Record<string, unknown>;
}
