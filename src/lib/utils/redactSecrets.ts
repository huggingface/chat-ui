/**
 * Sandbox commands carry live credentials. Ordered so the longest context wins:
 * a quoted value is consumed whole before the bare-token pattern can nibble at
 * its first word, and a flag takes its argument with it.
 *
 * Not a proof of absence — a denylist over free-form shell never is — which is
 * also why arguments are truncated and outputs are never stored at all.
 */
const QUOTED_OR_BARE = `(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;}]+)`;
const SECRET_WORD = `(?:token|secret|password|passwd|api[_-]?key|credential)s?`;

const SECRET_PATTERNS: RegExp[] = [
	// KEY="value with spaces", KEY='...', KEY=bare
	new RegExp(`\\b[A-Za-z_][A-Za-z0-9_]*${SECRET_WORD}\\s*[:=]\\s*${QUOTED_OR_BARE}`, "gi"),
	// --password hunter2, --api-key=abc, -p secret
	new RegExp(`(^|\\s)--?[A-Za-z0-9-]*${SECRET_WORD}[=\\s]+${QUOTED_OR_BARE}`, "gi"),
	// "password": "…" and password: … in JSON or prose
	new RegExp(`("|')?${SECRET_WORD}\\1?\\s*[:=]\\s*${QUOTED_OR_BARE}`, "gi"),
	/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
	/\b(?:hf_|github_pat_|ghp_|gho_|sk-)[A-Za-z0-9_-]{8,}/g,
];
export function redactSecrets(text: string): string {
	return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, "<redacted>"), text);
}

const SECRET_KEY = new RegExp(`${SECRET_WORD}$`, "i");

/**
 * the patterns miss prefixed json keys like WANDB_API_KEY, so every string under a secret named key
 * goes whole, numbers stay for max_tokens
 */
export function redactToolArguments(value: unknown, secretKey = false): unknown {
	if (typeof value === "string") return secretKey ? "<redacted>" : redactSecrets(value);
	if (Array.isArray(value)) return value.map((item) => redactToolArguments(item, secretKey));
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				redactToolArguments(item, secretKey || SECRET_KEY.test(key)),
			])
		);
	}
	return value;
}
