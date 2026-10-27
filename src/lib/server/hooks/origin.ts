/** Browsers can send the literal "null" for an opaque origin after redirects. */
export function parseRequestOrigin(origin: string | null): URL | undefined {
	if (!origin) return undefined;
	try {
		const url = new URL(origin);
		return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
	} catch {
		return undefined;
	}
}
