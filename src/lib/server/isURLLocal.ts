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
