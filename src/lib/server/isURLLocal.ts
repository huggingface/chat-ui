import { Address6, Address4 } from "ip-address";

import dns from "node:dns";

export async function isURLLocal(URL: URL): Promise<boolean> {
	const isLocal = new Promise<boolean>((resolve, reject) => {
		dns.lookup(URL.hostname, (err, address, family) => {
			if (err) {
				reject(err);
			}
			if (family === 4) {
				const addr = new Address4(address);
				resolve(addr.isInSubnet(new Address4("127.0.0.0/8")));
			} else if (family === 6) {
				const addr = new Address6(address);
				resolve(
					addr.isLoopback() || addr.isInSubnet(new Address6("::1/128")) || addr.isLinkLocal()
				);
			} else {
				reject(new Error("Unknown IP family"));
			}
		});
	});

	return isLocal;
}
