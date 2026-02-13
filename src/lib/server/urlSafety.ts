import dns from "node:dns";
import ipaddr from "ipaddr.js";

const BLOCKED_IP_RANGES = new Set([
	"unspecified",
	"broadcast",
	"multicast",
	"linkLocal",
	"loopback",
	"private",
	"reserved",
]);

/**
 * Resolve an IP address string to its effective range,
 * unwrapping IPv6-mapped IPv4 addresses.
 */
function getIpRange(ip: string): string {
	const parsed = ipaddr.parse(ip);

	// Unwrap ::ffff:x.x.x.x to check the inner IPv4 range
	if (parsed.kind() === "ipv6") {
		const ipv6 = parsed as ipaddr.IPv6;
		if (ipv6.isIPv4MappedAddress()) {
			return ipv6.toIPv4Address().range();
		}
	}

	return parsed.range();
}

/**
 * Check if a resolved IP address is internal/private.
 */
function isInternalIP(ip: string): boolean {
	try {
		return BLOCKED_IP_RANGES.has(getIpRange(ip));
	} catch {
		// If we can't parse it, treat it as unsafe
		return true;
	}
}

/**
 * Basic synchronous URL shape check: protocol, hostname format.
 * Does NOT check resolved IP (use isValidUrlWithDNS for that).
 */
export function isValidUrl(urlString: string): boolean {
	try {
		const url = new URL(urlString.trim());

		if (url.protocol !== "https:") {
			return false;
		}

		const hostname = url.hostname.toLowerCase();

		// Block obvious localhost/private hostnames
		if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
			return false;
		}

		// If the hostname is a raw IP, check it immediately
		if (ipaddr.isValid(hostname)) {
			return !isInternalIP(hostname);
		}

		// Strip brackets for IPv6 literals (e.g. [::1])
		const bare = hostname.replace(/^\[|\]$/g, "");
		if (ipaddr.isValid(bare)) {
			return !isInternalIP(bare);
		}

		return true;
	} catch {
		return false;
	}
}

/**
 * Full async URL validation with DNS resolution.
 * Resolves the hostname and checks the resulting IP is not internal.
 * This prevents SSRF via domains that resolve to private IPs.
 */
export async function isValidUrlWithDNS(urlString: string): Promise<boolean> {
	// First pass the basic checks
	if (!isValidUrl(urlString)) {
		return false;
	}

	try {
		const url = new URL(urlString.trim());
		const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

		// If it's already an IP, we checked it in isValidUrl
		if (ipaddr.isValid(hostname)) {
			return true;
		}

		// Resolve DNS and check all returned addresses
		const { address } = await dns.promises.lookup(hostname, { all: false });

		if (isInternalIP(address)) {
			return false;
		}

		return true;
	} catch {
		return false;
	}
}
