import type { App } from "$api";
import { base } from "$app/paths";
import { treaty, type Treaty } from "@elysiajs/eden";
import { browser } from "$app/environment";
import superjson from "superjson";

export function useAPIClient({ fetch }: { fetch?: Treaty.Config["fetcher"] } = {}) {
	let url;

	if (!browser) {
		let port;
		if (process.argv.includes("--port")) {
			port = parseInt(process.argv[process.argv.indexOf("--port") + 1]);
		} else {
			const mode = process.argv.find((arg) => arg === "preview" || arg === "dev");
			if (mode === "preview") {
				port = 4173;
			} else if (mode === "dev") {
				port = 5173;
			} else {
				port = 3000;
			}
		}
		// Always use localhost for server-side requests to avoid external HTTP calls during SSR
		url = `http://localhost:${port}${base}/api/v2`;
	} else {
		url = `${window.location.origin}${base}/api/v2`;
	}
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Success<T extends (...args: any) => any> =
	Awaited<ReturnType<T>> extends {
		data: infer D;
		error: unknown;
	}
		? D
		: never;
