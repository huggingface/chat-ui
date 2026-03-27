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

const dnsLookupAll = (
	hostname: string
): Promise<Array<{ address: string; family: number }>> => {
	return new Promise((resolve, reject) => {
		dns.lookup(hostname, { all: true }, (err, addresses) => {
			if (err) return reject(err);
			resolve(addresses);
		});
	});
};

function assertValidHostname(hostname: string): void {
	if (!hostname || hostname.length > 253) {
		throw new Error("Invalid hostname");
	}

	const labels = hostname.split(".");

	for (const label of labels) {
		if (!label || label.length > 63) {
			throw new Error("Invalid hostname");
		}

		if (!/^[A-Za-z0-9-]+$/.test(label)) {
			throw new Error("Invalid hostname");
		}

		if (label.startsWith("-") || label.endsWith("-")) {
			throw new Error("Invalid hostname");
		}
	}
}

export async function isURLLocal(URL: URL): Promise<boolean> {
	if (!isIP(URL.hostname)) {
		assertValidHostname(URL.hostname);
	}

	const addresses = await dnsLookupAll(URL.hostname);

	for (const { address, family } of addresses) {
		if (family === 4) {
			const addr = new Address4(address);
			const localSubnet = new Address4("127.0.0.0/8");
			if (addr.isInSubnet(localSubnet)) return true;
		} else if (family === 6) {
			const addr = new Address6(address);
			if (addr.isLoopback() || addr.isInSubnet(new Address6("::1/128")) || addr.isLinkLocal()) {
				return true;
			}
		}
	}

	return false;
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

/** Check if an IPv4 address falls in any private/reserved range (RFC 1918, loopback, link-local). */
export function isPrivateIPv4(address: string): boolean {
	const addr = new Address4(address);
	const privateRanges = [
		new Address4("10.0.0.0/8"),
		new Address4("172.16.0.0/12"),
		new Address4("192.168.0.0/16"),
		new Address4("127.0.0.0/8"),
		new Address4("169.254.0.0/16"),
		new Address4("0.0.0.0/8"),
	];
	return privateRanges.some((range) => addr.isInSubnet(range));
}

/** Check if an IPv6 address is loopback, link-local, or unique-local. */
export function isPrivateIPv6(address: string): boolean {
	const addr = new Address6(address);
	return addr.isLoopback() || addr.isLinkLocal() || addr.isInSubnet(new Address6("fc00::/7"));
}

/** Check if a URL resolves to a private/reserved IP address (SSRF protection).
 *  Resolves all DNS records and rejects if ANY address is private/reserved. */
export async function isURLPrivate(url: URL): Promise<boolean> {
	const addresses = await dnsLookupAll(url.hostname);

	for (const { address, family } of addresses) {
		if (family === 4 && isPrivateIPv4(address)) return true;
		if (family === 6 && isPrivateIPv6(address)) return true;
	}

	return false;
}

/** Validate that a URL is safe for external fetch (protocol + private IP check). */
export async function validateExternalUrl(
	url: string,
	opts?: { allowHttp?: boolean }
): Promise<URL> {
	const parsed = new URL(url);
	const protocol = parsed.protocol.toLowerCase();

	if (protocol !== "https:" && !(opts?.allowHttp && protocol === "http:")) {
		throw new Error(`Disallowed protocol: ${protocol}`);
	}

	if (await isURLPrivate(parsed)) {
		throw new Error("URL resolves to a private/reserved IP address");
	}

	return parsed;
}
