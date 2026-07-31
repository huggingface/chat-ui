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

/**
 * Whether a completion stopped at the output limit *and* left a tool call unusable.
 *
 * `finish_reason: "length"` alone does not mean the calls are broken: the limit can
 * land after a complete arguments object, and a no-argument call is complete when
 * empty. Discarding those would retry, and eventually give up on, a call that was fine.
 */
export function hasTruncatedToolCall(
	finishReason: string | null | undefined,
	calls: Iterable<{ name?: string; arguments?: string }>
): boolean {
	if (finishReason !== "length") return false;
	for (const call of calls) {
		// A call cut off before its name arrived is unusable even if its arguments parse.
		if (!call.name || parseToolArguments(call.arguments) === null) return true;
	}
	return false;
}
