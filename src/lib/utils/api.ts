import type { App } from "$lib/server/api/server";
import { edenFetch } from "@elysiajs/eden";

type Fetch = typeof fetch;

export function useEdenFetch({ fetch }: { fetch: Fetch }) {
	const app = edenFetch<App>("http://localhost:5173/chat/api/v2", {
		fetcher: fetch,
	});

	return app;
}
