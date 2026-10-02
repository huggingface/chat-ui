import { describe, it, expect, vi, beforeEach } from "vitest";

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

const { logger } = await import("$lib/server/logger");
const { ssrfLookup, ssrfSafeFetch } = await import("./urlSafety");

function lookup(hostname: string, exempt?: (hostname: string) => boolean) {
	return new Promise<{ err: Error | null; address: unknown }>((resolve) =>
		ssrfLookup(exempt)(hostname, {}, (err, address) => resolve({ err, address }))
	);
}

describe("ssrfLookup logging", () => {
	beforeEach(() => vi.clearAllMocks());

	it("logs the host and addresses of an allowed resolution", async () => {
		const { err, address } = await lookup("example.com");
		expect(err).toBeNull();
		expect(address).toBe("93.184.216.34");
		expect(logger.info).toHaveBeenCalledWith(
			{ fetch_host: "example.com", fetch_addresses: ["93.184.216.34"] },
			"Outbound fetch resolved"
		);
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("blocks and logs a public name that resolves to loopback", async () => {
		const { err } = await lookup("127.0.0.1.nip.io");
		expect(err?.message).toContain("is internal");
		expect(logger.warn).toHaveBeenCalledWith(
			{ fetch_host: "127.0.0.1.nip.io", fetch_addresses: ["127.0.0.1"] },
			expect.stringContaining("blocked")
		);
		expect(logger.info).not.toHaveBeenCalled();
	});

	it("blocks when any address of a multi-address answer is internal, and logs them all", async () => {
		const { err } = await lookup("mixed.example");
		expect(err).not.toBeNull();
		expect(logger.warn).toHaveBeenCalledWith(
			{ fetch_host: "mixed.example", fetch_addresses: ["93.184.216.34", "169.254.169.254"] },
			expect.stringContaining("blocked")
		);
	});

	it("lets an exempt host through and still logs it", async () => {
		const { err } = await lookup("localhost", (hostname) => hostname === "localhost");
		expect(err).toBeNull();
		expect(logger.info).toHaveBeenCalledWith(
			{ fetch_host: "localhost", fetch_addresses: ["127.0.0.1"] },
			"Outbound fetch resolved"
		);
	});

	it("logs a blocked IP literal, which never reaches the DNS hook", async () => {
		await expect(ssrfSafeFetch("https://169.254.169.254/latest/meta-data/")).rejects.toThrow(
			"unsafe IP"
		);
		expect(logger.warn).toHaveBeenCalledWith(
			{ fetch_host: "169.254.169.254" },
			expect.stringContaining("unsafe IP literal")
		);
	});
});
