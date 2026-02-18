import { Address6, Address4 } from "ip-address";
import dns from "node:dns";
import { isIP } from "node:net";

const dnsLookup = (hostname: string): Promise<{ address: string; family: number }> => {
	return new Promise((resolve, reject) => {
		dns.lookup(hostname, (err, address, family) => {
			if (err) return reject(err);
			resolve({ address, family });
		});
	});
};

/**
 * Checks if an IPv4 address is in a private/internal range.
 * Private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16
 */
function isPrivateIPv4(address: string): boolean {
	const addr = new Address4(address);
	const privateSubnets = [
		new Address4("10.0.0.0/8"), // Private Class A
		new Address4("172.16.0.0/12"), // Private Class B
		new Address4("192.168.0.0/16"), // Private Class C
		new Address4("127.0.0.0/8"), // Loopback
		new Address4("169.254.0.0/16"), // Link-local
		new Address4("0.0.0.0/8"), // "This" network
	];
	return privateSubnets.some((subnet) => addr.isInSubnet(subnet));
}

/**
 * Checks if an IPv6 address is in a private/internal range.
 */
function isPrivateIPv6(address: string): boolean {
	const addr = new Address6(address);
	return (
		addr.isLoopback() ||
		addr.isInSubnet(new Address6("::1/128")) ||
		addr.isLinkLocal() ||
		addr.isInSubnet(new Address6("fc00::/7")) || // Unique local
		addr.isInSubnet(new Address6("fe80::/10")) // Link-local
	);
}

export async function isURLLocal(URL: URL): Promise<boolean> {
	const { address, family } = await dnsLookup(URL.hostname);

	if (family === 4) {
		const addr = new Address4(address);
		const localSubnet = new Address4("127.0.0.0/8");
		return addr.isInSubnet(localSubnet);
	}

	if (family === 6) {
		const addr = new Address6(address);
		return addr.isLoopback() || addr.isInSubnet(new Address6("::1/128")) || addr.isLinkLocal();
	}

	throw Error("Unknown IP family");
}

/**
 * Validates if a URL is safe for server-side requests (SSRF protection).
 * Returns true if the URL resolves to a private/internal IP address.
 */
export async function isURLPrivate(url: URL): Promise<boolean> {
	try {
		const { address, family } = await dnsLookup(url.hostname);

		if (family === 4) {
			return isPrivateIPv4(address);
		}

		if (family === 6) {
			return isPrivateIPv6(address);
		}

		return true; // Unknown family, treat as private for safety
	} catch {
		// DNS lookup failed, treat as potentially dangerous
		return true;
	}
}

/**
 * Validates a URL for safe external fetching (SSRF protection).
 * Only allows HTTPS URLs that resolve to public IP addresses.
 */
export async function validateExternalUrl(urlString: string, allowHttp = false): Promise<URL> {
	const url = new URL(urlString);

	// Only allow http(s) protocols
	if (!["http:", "https:"].includes(url.protocol)) {
		throw new Error(`Invalid protocol: ${url.protocol}. Only HTTP(S) allowed.`);
	}

	// Require HTTPS unless explicitly allowed
	if (!allowHttp && url.protocol !== "https:") {
		throw new Error("Only HTTPS URLs are allowed for external requests");
	}

	// Check if URL resolves to private IP
	if (await isURLPrivate(url)) {
		throw new Error("URL resolves to a private/internal IP address");
	}

	return url;
}

export function isURLStringLocal(url: string) {
	try {
		const urlObj = new URL(url);
		return isURLLocal(urlObj);
	} catch (e) {
		// assume local if URL parsing fails
		return true;
	}
}

export function isHostLocalhost(host: string): boolean {
	if (host === "localhost") return true;
	if (host === "::1" || host === "[::1]") return true;
	if (host.startsWith("127.") && isIP(host)) return true;
	if (host.endsWith(".localhost")) return true;

	return false;
}
