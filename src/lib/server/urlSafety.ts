import { isIP } from "node:net";
import dns from "node:dns";
import ipaddr from "ipaddr.js";

const UNSAFE_IP_RANGES = new Set(["unspecified", "loopback", "private", "linkLocal"]);

function isUnsafeIp(address: string): boolean {
	const parsed = ipaddr.parse(address);
	// Handle IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1)
	const effective =
		parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()
			? (parsed as ipaddr.IPv6).toIPv4Address()
			: parsed;
	return UNSAFE_IP_RANGES.has(effective.range());
}

/**
 * Synchronous URL validation: checks protocol and hostname string.
 * Use `isResolvedUrlSafe` for DNS-resolved IP checks.
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
		if (isIP(hostname.replace(/^\[|]$/g, ""))) {
			return !isUnsafeIp(hostname.replace(/^\[|]$/g, ""));
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve a URL's hostname via DNS and reject internal IPs.
 * Throws if the resolved IP is internal (SSRF protection against DNS rebinding).
 */
export async function assertResolvedUrlSafe(urlString: string): Promise<void> {
	const { hostname } = new URL(urlString);
	const cleanHostname = hostname.replace(/^\[|]$/g, "");

	// If already an IP literal, check directly
	if (isIP(cleanHostname)) {
		if (isUnsafeIp(cleanHostname)) {
			throw new Error(`Resolved IP for ${hostname} is internal`);
		}
		return;
	}

	// DNS lookup to get actual IP
	const addresses = await dns.promises.lookup(cleanHostname, { all: true });
	for (const { address } of addresses) {
		if (isUnsafeIp(address)) {
			throw new Error(`Resolved IP for ${hostname} is internal (${address})`);
		}
	}
}
