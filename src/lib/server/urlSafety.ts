import { Address4, Address6 } from "ip-address";
import { isIP } from "node:net";
import dns from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";

const UNSAFE_IPV4_SUBNETS = [
	"0.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.168.0.0/16",
].map((s) => new Address4(s));

function isUnsafeIp(address: string): boolean {
	const family = isIP(address);

	if (family === 4) {
		const addr = new Address4(address);
		return UNSAFE_IPV4_SUBNETS.some((subnet) => addr.isInSubnet(subnet));
	}

	if (family === 6) {
		const addr = new Address6(address);
		// Check IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1)
		if (addr.is4()) {
			const v4 = addr.to4();
			return UNSAFE_IPV4_SUBNETS.some((subnet) => v4.isInSubnet(subnet));
		}
		return addr.isLoopback() || addr.isLinkLocal();
	}

	return true; // Unknown format → block
}

/**
 * Synchronous URL validation: checks protocol and hostname string.
 */
export function isValidUrl(urlString: string): boolean {
	try {
		const url = new URL(urlString.trim());
		if (url.protocol !== "https:") {
			return false;
		}
		const hostname = url.hostname.toLowerCase();
		if (hostname === "localhost") {
			return false;
		}
		// If the hostname is a raw IP literal, validate it
		const cleanHostname = hostname.replace(/^\[|]$/g, "");
		if (isIP(cleanHostname)) {
			return !isUnsafeIp(cleanHostname);
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
const ssrfSafeAgent = new Agent({
	connect: {
		lookup: (hostname, options, callback) => {
			dns.lookup(hostname, options, (err, address, family) => {
				if (err) return callback(err, "", 4);
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

const MAX_REDIRECTS = 5;

/**
 * Fetch wrapper that validates resolved IPs at connection time
 * and validates redirect targets to prevent SSRF via open redirects.
 *
 * If the caller sets `redirect: "manual"`, redirects are returned as-is
 * (the caller is responsible for validation). Otherwise, redirects are
 * followed internally with each hop validated by `isValidUrl`.
 */
export async function ssrfSafeFetch(url: string | URL, init?: RequestInit): Promise<Response> {
	const callerHandlesRedirects = init?.redirect === "manual";

	let currentUrl = url.toString();
	let redirectCount = 0;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const response = (await undiciFetch(currentUrl, {
			...(init as Record<string, unknown>),
			redirect: "manual",
			dispatcher: ssrfSafeAgent,
		})) as unknown as Response;

		if (!callerHandlesRedirects && response.status >= 300 && response.status < 400) {
			redirectCount++;
			if (redirectCount > MAX_REDIRECTS) {
				throw new Error("Too many redirects");
			}

			const location = response.headers.get("location");
			if (!location) {
				throw new Error("Redirect without Location header");
			}

			const redirectUrl = new URL(location, currentUrl).toString();
			if (!isValidUrl(redirectUrl)) {
				throw new Error(`Redirect to unsafe URL blocked (SSRF): ${redirectUrl}`);
			}

			currentUrl = redirectUrl;
			continue;
		}

		return response;
	}
}
