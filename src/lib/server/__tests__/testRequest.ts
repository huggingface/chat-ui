/**
 * Invokes a route handler through the real `handle` hook, so auth, CSRF, CORS and cookie
 * refresh run as they do in production. Only path-to-handler routing is stubbed. A thrown
 * `error()` or `redirect()` comes back as a `Response`, so assert `res.status` rather than
 * catching.
 *
 * Authenticate either with a session cookie from `createTestUser()`, or by passing `locals`.
 * `locals` is applied after the hook has authenticated, so it changes what the handler sees
 * but not what the middleware saw — assertions about identity-keyed middleware rules need
 * the cookie.
 */
import {
	isHttpError,
	isRedirect,
	type Cookies,
	type RequestEvent,
	type RequestHandler,
} from "@sveltejs/kit";
// Not `hooks.server.ts`'s `handle`, which would pull `hooks/init.ts` — the migration runner,
// MCP registry and font loader — into every spec. Same code path under Vitest.
import { handleRequest } from "$lib/server/hooks/handle";
import { ready } from "$lib/server/database";

/** The `Origin` a native-form POST must send to satisfy the CSRF check in `handle`. */
export const TEST_ORIGIN = "http://localhost:5173";

export interface TestRequestOptions {
	/** Origin-relative, query string included: `"/api/v2/conversations?p=1"`. */
	path: string;
	/** Defaults to `GET`. */
	method?: string;
	body?: BodyInit;
	headers?: HeadersInit;
	params?: Record<string, string>;
	locals?: Partial<App.Locals>;
}

type CookieSetOptions = Parameters<Cookies["set"]>[2];

function serializeCookie(name: string, value: string, opts: CookieSetOptions): string {
	const parts = [`${name}=${encodeURIComponent(value)}`];

	if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
	if (opts.domain) parts.push(`Domain=${opts.domain}`);
	if (opts.path) parts.push(`Path=${opts.path}`);
	if (opts.expires) parts.push(`Expires=${new Date(opts.expires).toUTCString()}`);
	if (opts.httpOnly) parts.push("HttpOnly");
	if (opts.secure) parts.push("Secure");
	if (opts.sameSite) {
		const sameSite = opts.sameSite === true ? "strict" : opts.sameSite;
		parts.push(`SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`);
	}

	return parts.join("; ");
}

function parseCookieHeader(header: string | null): Map<string, string> {
	const jar = new Map<string, string>();
	if (!header) return jar;

	for (const pair of header.split(";")) {
		const eq = pair.indexOf("=");
		if (eq < 0) continue;
		const name = pair.slice(0, eq).trim();
		if (!name) continue;
		jar.set(name, decodeURIComponent(pair.slice(eq + 1).trim()));
	}

	return jar;
}

/** Stand-in for SvelteKit's cookie jar, which is internal and not importable. */
function createCookies(request: Request): {
	cookies: Cookies;
	setCookieHeaders: () => string[];
} {
	const jar = parseCookieHeader(request.headers.get("cookie"));
	const written: string[] = [];

	return {
		cookies: {
			get: (name) => jar.get(name),
			getAll: () => [...jar].map(([name, value]) => ({ name, value })),
			set: (name, value, opts) => {
				jar.set(name, value);
				written.push(serializeCookie(name, value, opts));
			},
			delete: (name, opts) => {
				jar.delete(name);
				written.push(serializeCookie(name, "", { ...opts, maxAge: 0 }));
			},
			serialize: (name, value, opts) => serializeCookie(name, value, opts),
		},
		setCookieHeaders: () => written,
	};
}

/**
 * Tracing is off in tests, but SvelteKit types these as OpenTelemetry `Span`s — a
 * self-returning proxy satisfies any chained call a handler makes.
 */
const NOOP_SPAN: unknown = new Proxy(
	{},
	{
		get:
			() =>
			(...args: unknown[]) => {
				void args;
				return NOOP_SPAN;
			},
	}
);

const NOOP_TRACING = {
	enabled: false,
	root: NOOP_SPAN,
	current: NOOP_SPAN,
} as RequestEvent["tracing"];

/** Anything that is not a SvelteKit `error()` or `redirect()` is a genuine fault. */
function toResponse(thrown: unknown): Response {
	if (isRedirect(thrown)) {
		return new Response(undefined, {
			status: thrown.status,
			headers: { location: thrown.location },
		});
	}

	if (isHttpError(thrown)) {
		return new Response(JSON.stringify(thrown.body), {
			status: thrown.status,
			headers: { "content-type": "application/json" },
		});
	}

	throw thrown;
}

export async function testRequest(
	handler: RequestHandler,
	opts: TestRequestOptions
): Promise<Response> {
	// `collections` is undefined until the database IIFE resolves, and `handle` writes to
	// `collections.sessions` on POST.
	await ready;

	const url = new URL(opts.path, TEST_ORIGIN);
	const method = (opts.method ?? "GET").toUpperCase();
	const hasBody = opts.body !== undefined && method !== "GET" && method !== "HEAD";

	const request = new Request(url, {
		method,
		headers: opts.headers,
		...(hasBody ? { body: opts.body } : {}),
	});

	const { cookies, setCookieHeaders } = createCookies(request);
	const deferredHeaders = new Map<string, string>();

	const event: RequestEvent = {
		cookies,
		fetch: globalThis.fetch,
		getClientAddress: () => "127.0.0.1",
		locals: {} as App.Locals,
		params: (opts.params ?? {}) as RequestEvent["params"],
		platform: undefined,
		request,
		route: { id: null },
		setHeaders: (headers) => {
			for (const [rawKey, value] of Object.entries(headers)) {
				const key = rawKey.toLowerCase();
				if (key === "set-cookie") {
					throw new Error("Use `cookies.set(...)` rather than `setHeaders` for set-cookie");
				}
				if (deferredHeaders.has(key)) {
					throw new Error(`"${key}" header is already set`);
				}
				deferredHeaders.set(key, value);
			}
		},
		url,
		isDataRequest: false,
		isSubRequest: false,
		isRemoteRequest: false,
		tracing: NOOP_TRACING,
	};

	const response = await handleRequest({
		event,
		resolve: async (resolvedEvent) => {
			// Deliberately after the hook has authenticated — see the module docs.
			if (opts.locals) {
				Object.assign(resolvedEvent.locals, opts.locals);
			}

			let res: Response;
			try {
				res = await handler(resolvedEvent);
			} catch (thrown) {
				res = toResponse(thrown);
			}

			for (const [key, value] of deferredHeaders) {
				res.headers.set(key, value);
			}

			return res;
		},
	});

	for (const header of setCookieHeaders()) {
		response.headers.append("set-cookie", header);
	}

	return response;
}
