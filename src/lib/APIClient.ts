import type { App } from "$api";
import { base } from "$app/paths";
import { treaty, type Treaty } from "@elysiajs/eden";
import { browser } from "$app/environment";
import superjson from "superjson";
import ObjectId from "bson-objectid";

superjson.registerCustom<ObjectId, string>(
	{
		isApplicable: (value): value is ObjectId => {
			if (typeof value !== "string" && ObjectId.isValid(value)) {
				const str = value.toString();
				return /^[0-9a-fA-F]{24}$/.test(str);
			}
			return false;
		},
		serialize: (value) => value.toString(),
		deserialize: (value) => new ObjectId(value),
	},
	"ObjectId"
);

export function useAPIClient({
	fetch,
	origin,
}: {
	fetch?: Treaty.Config["fetcher"];
	origin?: string;
} = {}) {
	// On the server, use the current request origin when available to avoid
	// incorrect port guessing and ensure cookies are forwarded properly.
	// Fall back to a sane default in dev if origin is missing.
	const url = browser
		? `${window.location.origin}${base}/api/v2`
		: `${origin ?? `http://localhost:5173`}${base}/api/v2`;

	const app = treaty<App>(url, { fetcher: fetch });
	return app;
}

export function handleResponse<T extends Record<number, unknown>>(
	response: Treaty.TreatyResponse<T>
): T[200] {
	if (response.error) {
		throw new Error(JSON.stringify(response.error));
	}

	return superjson.parse(
		typeof response.data === "string" ? response.data : JSON.stringify(response.data)
	) as T[200];
}
