import type { Serialize } from "./serialize";

export async function fetchJSON<T>(
	url: string,
	options?: { fetch?: typeof window.fetch }
): Promise<Serialize<T>> {
	const response = await (options?.fetch ?? fetch)(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
	}
	return response.json();
}
