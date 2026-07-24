import { Address4, Address6 } from "ip-address";
import { isIP } from "node:net";
import dns from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import { env } from "$env/dynamic/private";

const UNSAFE_IPV4_SUBNETS = [
	"0.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.168.0.0/16",
].map((s) => new Address4(s));

// IPv4-mapped IPv6 range. Matched as a subnet rather than with ip-address's `is4()`, which
// only recognises the dotted textual form: the URL parser rewrites `::ffff:127.0.0.1` to its
// canonical hex form `::ffff:7f00:1`, for which `is4()` returns false.
const IPV4_MAPPED_IPV6_SUBNET = new Address6("::ffff:0:0/96");

// Unique local addresses (fc00::/7) are the IPv6 counterpart of the private IPv4 ranges;
// `isLoopback()`/`isLinkLocal()` do not cover them.
const UNIQUE_LOCAL_IPV6_SUBNET = new Address6("fc00::/7");

/** IPv6 literals arrive from `URL.hostname` bracketed; `isIP` only accepts them bare. */
function stripBrackets(hostname: string): string {
	return hostname.replace(/^\[|]$/g, "");
}

function isUnsafeIp(address: string): boolean {
	const family = isIP(address);

	if (family === 4) {
		const addr = new Address4(address);
		return UNSAFE_IPV4_SUBNETS.some((subnet) => addr.isInSubnet(subnet));
	}

	if (family === 6) {
		const addr = new Address6(address);
		// IPv4-mapped addresses (e.g. ::ffff:127.0.0.1) connect to the embedded IPv4 host.
		if (addr.isInSubnet(IPV4_MAPPED_IPV6_SUBNET)) {
			const v4 = addr.to4();
			return UNSAFE_IPV4_SUBNETS.some((subnet) => v4.isInSubnet(subnet));
		}
		// The unspecified address reaches localhost, exactly as 0.0.0.0 does.
		if (addr.correctForm() === "::") {
			return true;
		}
		// Unique local addresses (fc00::/7) are private, like 10.0.0.0/8 for IPv4.
		if (addr.isInSubnet(UNIQUE_LOCAL_IPV6_SUBNET)) {
			return true;
		}
		return addr.isLoopback() || addr.isLinkLocal();
	}

	return true; // Unknown format → block
}

/**
 * Not the inverse of `UNSAFE_IPV4_SUBNETS`, and must not be unified with it: link-local
 * (169.254.0.0/16) carries the cloud metadata service, so it stays blocked even here.
 */
const LOCAL_MCP_IPV4_SUBNETS = ["10.0.0.0/8", "127.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].map(
	(s) => new Address4(s)
);

function isLocalMcpIp(address: string): boolean {
	const family = isIP(address);

	if (family === 4) {
		const addr = new Address4(address);
		return LOCAL_MCP_IPV4_SUBNETS.some((subnet) => addr.isInSubnet(subnet));
	}

	if (family === 6) {
		const addr = new Address6(address);
		if (addr.is4()) {
			const v4 = addr.to4();
			return LOCAL_MCP_IPV4_SUBNETS.some((subnet) => v4.isInSubnet(subnet));
		}
		return addr.isLoopback();
	}

	return false;
}

function isLocalMcpHost(hostname: string): boolean {
	if (hostname === "localhost") {
		return true;
	}
	const cleanHostname = hostname.replace(/^\[|]$/g, "");
	return isIP(cleanHostname) !== 0 && isLocalMcpIp(cleanHostname);
}

/**
 * Read from the process environment rather than `$lib/server/config`, so that a config row in
 * the database can never switch SSRF protection off on a running deployment.
 */
function insecureMcpUrlsAllowed(): boolean {
	return env.MCP_ALLOW_INSECURE_URLS === "true";
}

export interface UrlSafetyOptions {
	/** Inert unless `MCP_ALLOW_INSECURE_URLS=true`, and even then only for local hosts. */
	allowInsecure?: boolean;
}

/**
 * Synchronous URL validation: checks protocol and hostname string.
 */
export function isValidUrl(
	urlString: string,
	{ allowInsecure = false }: UrlSafetyOptions = {}
): boolean {
	try {
		const url = new URL(urlString.trim());
		const hostname = url.hostname.toLowerCase();
		const insecure = allowInsecure && insecureMcpUrlsAllowed() && isLocalMcpHost(hostname);

		if (url.protocol !== "https:" && !(insecure && url.protocol === "http:")) {
			return false;
		}
		if (hostname === "localhost") {
			return insecure;
		}
		// If the hostname is a raw IP literal, validate it
		const cleanHostname = stripBrackets(hostname);
		if (isIP(cleanHostname)) {
			return insecure || !isUnsafeIp(cleanHostname);
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Assert that a resolved IP address is safe (not internal/private).
 * Throws if the IP is internal. Used in undici's custom DNS lookup
 * to validate IPs at connection time (prevents TOCTOU DNS rebinding).
 */
export function assertSafeIp(address: string, hostname: string): void {
	if (isUnsafeIp(address)) {
		throw new Error(`Resolved IP for ${hostname} is internal (${address})`);
	}
}

/**
 * Undici agent that validates resolved IPs at connection time,
 * preventing TOCTOU DNS rebinding attacks.
 */
function createSsrfAgent(exempt: (hostname: string) => boolean = () => false): Agent {
	return new Agent({
		connect: {
			lookup: (hostname, options, callback) => {
				dns.lookup(hostname, options, (err, address, family) => {
					if (err) return callback(err, "", 4);
					if (exempt(hostname.toLowerCase())) return callback(null, address, family);
					if (typeof address === "string") {
						try {
							assertSafeIp(address, hostname);
						} catch (e) {
							return callback(e as Error, "", 4);
						}
					} else if (Array.isArray(address)) {
						for (const entry of address) {
							try {
								assertSafeIp(entry.address, hostname);
							} catch (e) {
								return callback(e as Error, "", 4);
							}
						}
					}
					return callback(null, address, family);
				});
			},
		},
	});
}

const ssrfSafeAgent = createSsrfAgent();

/**
 * Only `localhost` needs the DNS-hook exemption — it is the sole local host that reaches this
 * hook (undici resolves it through DNS). Local IP literals never reach the hook and are gated
 * up front by `assertSafeUrlHost`, which applies the same insecure-local allowance instead.
 */
let localMcpAgent: Agent | undefined;
function getLocalMcpAgent(): Agent {
	localMcpAgent ??= createSsrfAgent((hostname) => hostname === "localhost");
	return localMcpAgent;
}

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Assert that a URL's host is safe before we connect to it.
 *
 * The agent's `lookup` hook only runs for hosts undici resolves through DNS, so a URL carrying a
 * raw IP literal would otherwise reach the network without `assertSafeIp` ever running. Checks
 * `isUnsafeIp` rather than `isValidUrl` because the latter also demands HTTPS, which would break
 * plain-HTTP MCP servers. When `allowLocal` is set (opt-in insecure MCP), local literals are
 * exempted so `mcpFetch` can still reach a `127.0.0.1`/LAN server before the socket opens.
 */
function assertSafeUrlHost(urlString: string, allowLocal: boolean): void {
	const host = stripBrackets(new URL(urlString).hostname.toLowerCase());
	if (isIP(host) && isUnsafeIp(host) && !(allowLocal && isLocalMcpIp(host))) {
		throw new Error(`Blocked request to unsafe IP (SSRF): ${host}`);
	}
}

/**
 * Fetch wrapper that rejects unsafe IP literals up front, validates resolved IPs at connection
 * time, and validates redirect targets to prevent SSRF via open redirects.
 *
 * If the caller sets `redirect: "manual"`, redirects are returned as-is (the caller is
 * responsible for validation). Otherwise, redirects are followed internally with each hop
 * validated by `isValidUrl`.
 */
async function guardedFetch(
	url: string | URL,
	init: RequestInit | undefined,
	options: UrlSafetyOptions
): Promise<Response> {
	const allowLocal = Boolean(options.allowInsecure) && insecureMcpUrlsAllowed();
	const dispatcher = allowLocal ? getLocalMcpAgent() : ssrfSafeAgent;
	const callerRedirect = init?.redirect ?? "follow";

	if (callerRedirect === "error") {
		// Honour redirect:"error" — make the request and throw if we get a redirect
		assertSafeUrlHost(url.toString(), allowLocal);
		const response = (await undiciFetch(url.toString(), {
			...(init as Record<string, unknown>),
			redirect: "manual",
			dispatcher,
		})) as unknown as Response;
		if (REDIRECT_STATUSES.has(response.status)) {
			throw new TypeError("unexpected redirect");
		}
		return response;
	}

	if (callerRedirect === "manual") {
		// Caller handles redirects — return as-is
		assertSafeUrlHost(url.toString(), allowLocal);
		return (await undiciFetch(url.toString(), {
			...(init as Record<string, unknown>),
			redirect: "manual",
			dispatcher,
		})) as unknown as Response;
	}

	// Default: follow redirects with SSRF validation on each hop
	let currentUrl = url.toString();
	let currentInit = init;
	let redirectCount = 0;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		assertSafeUrlHost(currentUrl, allowLocal);
		const response = (await undiciFetch(currentUrl, {
			...(currentInit as Record<string, unknown>),
			redirect: "manual",
			dispatcher,
		})) as unknown as Response;

		if (REDIRECT_STATUSES.has(response.status)) {
			redirectCount++;
			if (redirectCount > MAX_REDIRECTS) {
				throw new Error("Too many redirects");
			}

			const location = response.headers.get("location");
			if (!location) {
				throw new Error("Redirect without Location header");
			}

			const redirectUrl = new URL(location, currentUrl).toString();
			if (!isValidUrl(redirectUrl, options)) {
				throw new Error(`Redirect to unsafe URL blocked (SSRF): ${redirectUrl}`);
			}

			// Per fetch spec: 301/302 rewrite POST→GET; 303 rewrites any non-GET/HEAD→GET
			const method = (currentInit?.method ?? "GET").toUpperCase();
			if (
				([301, 302].includes(response.status) && method === "POST") ||
				(response.status === 303 && method !== "GET" && method !== "HEAD")
			) {
				currentInit = { ...init, method: "GET", body: undefined };
			}

			currentUrl = redirectUrl;
			continue;
		}

		return response;
	}
}

export function ssrfSafeFetch(url: string | URL, init?: RequestInit): Promise<Response> {
	return guardedFetch(url, init, {});
}

/**
 * `ssrfSafeFetch` for MCP transports, additionally allowing a local MCP server when
 * `MCP_ALLOW_INSECURE_URLS=true`. Public hostnames are treated identically either way.
 */
export function mcpFetch(url: string | URL, init?: RequestInit): Promise<Response> {
	return guardedFetch(url, init, { allowInsecure: true });
}
