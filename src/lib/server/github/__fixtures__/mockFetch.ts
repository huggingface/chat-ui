/**
 * A stand-in for `api.github.com` that records what was asked of it.
 *
 * The recording is half the point: several of the behaviours under test are
 * about the *requests* — that `ref: "HEAD"` sends no `?ref=`, that a cached tree
 * is revalidated rather than refetched, that a star sort does not quietly read
 * one arbitrary page — and those are invisible in the response alone.
 */

export interface RecordedRequest {
	url: string;
	path: string;
	headers: Record<string, string>;
}

export interface MockResponse {
	status?: number;
	/** Serialised as JSON; use `text` for a body that is not JSON. */
	json?: unknown;
	text?: string;
	headers?: Record<string, string>;
}

export type Responder = (request: RecordedRequest) => MockResponse | undefined;

export interface GithubFetchMock {
	requests: RecordedRequest[];
	/** Paths requested, in order — the usual assertion target. */
	paths: string[];
	restore(): void;
}

const API_ROOT = "https://api.github.com";

export function installGithubFetch(responder: Responder): GithubFetchMock {
	const previous = globalThis.fetch;
	const requests: RecordedRequest[] = [];

	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : String(input);
		if (!url.startsWith(API_ROOT)) return previous(input, init);

		// Real fetch rejects on an aborted signal rather than answering. Without this
		// a test asserting that cancellation propagates would pass against a mock that
		// silently ignored the signal.
		if (init?.signal?.aborted) {
			throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
		}

		const headers: Record<string, string> = {};
		for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
			headers[key.toLowerCase()] = value;
		}
		const request: RecordedRequest = { url, path: url.slice(API_ROOT.length), headers };
		requests.push(request);

		const response = responder(request);
		if (!response) {
			return new Response(JSON.stringify({ message: "Not Found" }), {
				status: 404,
				headers: { "content-type": "application/json" },
			});
		}
		const body =
			response.text !== undefined
				? response.text
				: response.json !== undefined
					? JSON.stringify(response.json)
					: "";
		return new Response(response.status === 304 ? null : body, {
			status: response.status ?? 200,
			headers: { "content-type": "application/json", ...(response.headers ?? {}) },
		});
	}) as typeof fetch;

	return {
		requests,
		get paths() {
			return requests.map((request) => request.path);
		},
		restore() {
			globalThis.fetch = previous;
		},
	};
}

/** Builds the `git/trees` payload for a list of blob paths. */
export function treeResponse(
	paths: Array<string | { path: string; size: number; type?: string }>,
	truncated = false
) {
	return {
		truncated,
		tree: paths.map((entry) =>
			typeof entry === "string"
				? { path: entry, type: "blob", size: 1024 }
				: { type: "blob", ...entry }
		),
	};
}
