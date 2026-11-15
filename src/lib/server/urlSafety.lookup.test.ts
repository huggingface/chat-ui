import { describe, it, expect, vi, beforeEach } from "vitest";
import { logger } from "$lib/server/logger";
import { ssrfLookup, ssrfSafeFetch } from "./urlSafety";

type Resolved = string | { address: string; family: number }[];
const RESOLUTIONS: Record<string, Resolved> = {
	"example.com": "93.184.216.34",
	// A public name that resolves into 127/8: the DNS-rebinding shape *.nip.io stands in for.
	"127.0.0.1.nip.io": "127.0.0.1",
	"mixed.example": [
		{ address: "93.184.216.34", family: 4 },
		{ address: "169.254.169.254", family: 4 },
	],
	localhost: "127.0.0.1",
};

vi.mock("node:dns", () => ({
	default: {
		lookup: (
			hostname: string,
			_options: unknown,
			cb: (err: Error | null, address: Resolved, family?: number) => void
		) => {
			const hit = RESOLUTIONS[hostname];
			if (!hit) return cb(new Error(`getaddrinfo ENOTFOUND ${hostname}`), "");
			cb(null, hit, 4);
		},
	},
}));

vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

function lookup(hostname: string, exempt?: (hostname: string) => boolean) {
	return new Promise<{ err: Error | null; address: unknown }>((resolve) =>
		ssrfLookup(exempt)(hostname, {}, (err, address) => resolve({ err, address }))
	);
}

describe("ssrfLookup logging", () => {
	beforeEach(() => vi.clearAllMocks());

	it.each([
		{ host: "example.com", addresses: ["93.184.216.34"] },
		{ host: "localhost", addresses: ["127.0.0.1"], exempt: (h: string) => h === "localhost" },
	])("lets $host through and logs it at info", async ({ host, addresses, exempt }) => {
		const { err } = await lookup(host, exempt);
		expect(err).toBeNull();
		expect(logger.info).toHaveBeenCalledWith(
			{ fetchHost: host, fetchAddresses: addresses },
			"Outbound fetch resolved"
		);
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it.each([
		{ host: "127.0.0.1.nip.io", addresses: ["127.0.0.1"] },
		{ host: "mixed.example", addresses: ["93.184.216.34", "169.254.169.254"] },
	])("blocks $host and logs every address at warn", async ({ host, addresses }) => {
		const { err } = await lookup(host);
		expect(err?.message).toContain("is internal");
		expect(logger.warn).toHaveBeenCalledWith(
			{ fetchHost: host, fetchAddresses: addresses },
			expect.stringContaining("blocked")
		);
		expect(logger.info).not.toHaveBeenCalled();
	});

	it("logs a failed lookup, which the DNS query still shows", async () => {
		const { err } = await lookup("nxdomain.example");
		expect(err?.message).toContain("ENOTFOUND");
		expect(logger.info).toHaveBeenCalledWith(
			{ fetchHost: "nxdomain.example", err },
			"Outbound fetch lookup failed"
		);
	});

	it("logs a blocked IP literal, which never reaches the DNS hook", async () => {
		await expect(ssrfSafeFetch("https://169.254.169.254/latest/meta-data/")).rejects.toThrow(
			"unsafe IP"
		);
		expect(logger.warn).toHaveBeenCalledWith(
			{ fetchHost: "169.254.169.254" },
			expect.stringContaining("unsafe IP literal")
		);
	});
});
