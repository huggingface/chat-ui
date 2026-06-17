/**
 * Replace any invalid UTF-8 byte sequences in `str` with the Unicode
 * replacement character (U+FFFD).
 *
 * JavaScript strings are UTF-16 internally, but a string can still contain
 * lone surrogates (e.g. \uD800–\uDFFF) that are not valid UTF-16 code-unit
 * pairs.  When such a string is serialised to BSON, the driver encodes it as
 * UTF-8 and the resulting byte sequence is rejected by MongoDB with:
 *
 *   BSONError: Invalid UTF-8 string in BSON document
 *
 * The round-trip through Buffer + TextDecoder normalises lone surrogates and
 * any other ill-formed sequences to U+FFFD so the string is safe to store.
 */
export function sanitizeUtf8(str: string): string {
	// Buffer.from encodes the JS string to bytes using UTF-8 (lone surrogates
	// become the 3-byte replacement sequence EF BF BD / U+FFFD).
	// TextDecoder with fatal:false then decodes those bytes back to a string,
	// replacing any remaining invalid sequences with U+FFFD.
	const bytes = Buffer.from(str, "utf8");
	return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * Recursively applies `sanitizeUtf8` to every string found while walking an
 * arbitrary value (objects, arrays, nested combinations). Used for
 * unstructured data (e.g. stream update payloads) where invalid UTF-8 could
 * be buried at any depth before a MongoDB write.
 */
export function sanitizeUtf8Deep<T>(value: T): T {
	if (typeof value === "string") {
		return sanitizeUtf8(value) as unknown as T;
	}
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeUtf8Deep(item)) as unknown as T;
	}
	if (value !== null && typeof value === "object" && !(value instanceof Date)) {
		const result: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value)) {
			result[key] = sanitizeUtf8Deep(val);
		}
		return result as unknown as T;
	}
	return value;
}
