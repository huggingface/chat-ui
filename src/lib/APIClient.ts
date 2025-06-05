import type { App } from "$api";
import { base } from "$app/paths";
import { treaty, type Treaty } from "@elysiajs/eden";
import { browser } from "$app/environment";

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

export function throwOnErrorNullable<T extends Record<number, unknown>>(
	response: Treaty.TreatyResponse<T>
): T[200] {
	if (response.error) {
		throw new Error(JSON.stringify(response.error));
	}

	return response.data as T[200];
}

export function throwOnError<T extends Record<number, unknown>>(
	response: Treaty.TreatyResponse<T>
): NonNullable<T[200]> {
	if (response.error) {
		throw new Error(JSON.stringify(response.error));
	}

	if (response.data === null) {
		throw new Error("No data received on API call");
	}

	return response.data as NonNullable<T[200]>;
}
