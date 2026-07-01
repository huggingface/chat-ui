import JSON5 from "json5";

export interface FeatureAnnouncement {
	title: string;
	description: string;
	link?: string;
	cta?: string;
}

// Values pasted from docker env files sometimes keep their backtick wrapping
// (same handling as sanitizeJSONEnv on the server).
function unquoteEnv(raw: string): string {
	const trimmed = raw.trim();
	return trimmed.startsWith("`") && trimmed.endsWith("`") ? trimmed.slice(1, -1) : trimmed;
}

function asTrimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

// Only http(s) URLs and app-relative paths; anything else (e.g. javascript:) is dropped.
function sanitizeLink(value: unknown): string | undefined {
	const link = asTrimmedString(value);
	if (!link) return undefined;
	if (link.startsWith("/")) return link;
	try {
		const protocol = new URL(link).protocol;
		return protocol === "https:" || protocol === "http:" ? link : undefined;
	} catch {
		return undefined;
	}
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// undefined = no expiry, null = invalid. A date-only string expires at the end
// of that day (UTC), so maxDate "2026-07-01" still shows on July 1st.
function parseMaxDate(value: unknown): Date | null | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string" && typeof value !== "number") return null;
	const input =
		typeof value === "string" && DATE_ONLY_RE.test(value.trim())
			? `${value.trim()}T23:59:59.999Z`
			: value;
	const date = new Date(input);
	return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Parses a feature announcements env value (JSON5 array of
 * `{ title, description, link?, maxDate? }`) and returns the last entry that
 * has a non-empty title and description and whose maxDate, if any, is not in
 * the past. An unparseable maxDate fails closed: better to skip an
 * announcement than to show a stale one forever.
 */
export function getActiveAnnouncement(
	raw: string | undefined,
	now: Date = new Date()
): FeatureAnnouncement | undefined {
	if (!raw?.trim()) return undefined;

	let parsed: unknown;
	try {
		parsed = JSON5.parse(unquoteEnv(raw));
	} catch (err) {
		console.warn("[featureAnnouncements] failed to parse announcements env value", err);
		return undefined;
	}
	if (!Array.isArray(parsed)) return undefined;

	for (let i = parsed.length - 1; i >= 0; i--) {
		const entry = parsed[i];
		if (typeof entry !== "object" || entry === null) continue;
		const { title, description, link, cta, maxDate } = entry as Record<string, unknown>;

		const cleanTitle = asTrimmedString(title);
		const cleanDescription = asTrimmedString(description);
		if (!cleanTitle || !cleanDescription) continue;

		const expiry = parseMaxDate(maxDate);
		if (expiry === null || (expiry && expiry.getTime() < now.getTime())) continue;

		return {
			title: cleanTitle,
			description: cleanDescription,
			link: sanitizeLink(link),
			cta: asTrimmedString(cta),
		};
	}

	return undefined;
}
