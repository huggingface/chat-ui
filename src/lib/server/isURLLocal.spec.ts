import { describe, expect, it, vi } from "vitest";

/*
 * `isURLLocal` resolves hostnames with `dns.lookup`. Left unmocked, this suite reached live
 * DNS — including the third-party wildcard resolvers `nip.io` and `sslip.io` — so it failed
 * offline and in network-restricted runners, and its verdict depended on records outside
 * this repo.
 *
 * Mocking the resolver keeps the part that actually matters under test (the loopback /
 * link-local subnet decision) and additionally makes address families and ranges reachable
 * that public DNS cannot conveniently produce: IPv6 link-local, a non-loopback private
 * range, and an unknown address family.
 *
 * Hostname *validation* runs before any lookup, so those cases need no mock at all.
 */
const RESOLUTIONS: Record<string, { address: string; family: number }> = {
	// Loopback
	localhost: { address: "127.0.0.1", family: 4 },
	"127.0.0.1": { address: "127.0.0.1", family: 4 },
	"127.254.254.254": { address: "127.254.254.254", family: 4 },
	// A hostname that resolves into 127/8 — the DNS-rebinding shape `nip.io` stood in for
	"loopback.example": { address: "127.0.0.1", family: 4 },
	// Public
	"huggingface.co": { address: "3.160.150.100", family: 4 },
	// Private but NOT loopback: isURLLocal deliberately only treats 127/8 as local.
	// See urlSafety.ts for the separate private-range checks layered on top.
	"private.example": { address: "10.0.0.1", family: 4 },
	// IPv6
	"v6-loopback.example": { address: "::1", family: 6 },
	"v6-linklocal.example": { address: "fe80::1", family: 6 },
	"v6-public.example": { address: "2606:4700:4700::1111", family: 6 },
	// Neither 4 nor 6
	"weird-family.example": { address: "0.0.0.0", family: 0 },
};

vi.mock("node:dns", () => ({
	default: {
		lookup: (
			hostname: string,
			cb: (err: Error | null, address?: string, family?: number) => void
		) => {
			const hit = RESOLUTIONS[hostname];
			if (!hit) {
				return cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {}));
			}
			cb(null, hit.address, hit.family);
		},
	},
}));

const { isURLLocal, isHostLocalhost } = await import("./isURLLocal");

describe("isURLLocal", () => {
	describe("loopback detection", () => {
		it("returns true for localhost", async () => {
			expect(await isURLLocal(new URL("http://localhost"))).toBe(true);
		});

		it("returns true for 127.0.0.1", async () => {
			expect(await isURLLocal(new URL("http://127.0.0.1"))).toBe(true);
		});

		it("returns true across the whole 127/8 range", async () => {
			expect(await isURLLocal(new URL("http://127.254.254.254"))).toBe(true);
		});

		it("returns true for a public hostname that resolves into 127/8", async () => {
			// The DNS-rebinding case: the name looks external, the address is loopback.
			expect(await isURLLocal(new URL("http://loopback.example"))).toBe(true);
		});

		it("returns false for a public address", async () => {
			expect(await isURLLocal(new URL("https://huggingface.co/"))).toBe(false);
		});

		it("returns false for private-but-not-loopback ranges", async () => {
			// Deliberate: isURLLocal answers "is this loopback", not "is this private".
			// RFC1918 filtering lives in urlSafety.ts.
			expect(await isURLLocal(new URL("http://private.example"))).toBe(false);
		});
	});

	describe("IPv6", () => {
		it("returns true for ::1", async () => {
			expect(await isURLLocal(new URL("http://v6-loopback.example"))).toBe(true);
		});

		it("returns true for link-local addresses", async () => {
			expect(await isURLLocal(new URL("http://v6-linklocal.example"))).toBe(true);
		});

		it("returns false for public IPv6", async () => {
			expect(await isURLLocal(new URL("http://v6-public.example"))).toBe(false);
		});
	});

	describe("rejections", () => {
		it("rejects an unknown address family", async () => {
			await expect(isURLLocal(new URL("http://weird-family.example"))).rejects.toThrow(
				"Unknown IP family"
			);
		});

		it("rejects when the hostname does not resolve", async () => {
			await expect(
				isURLLocal(new URL("http://34329487239847329874923948732984.com/"))
			).rejects.toThrow();
		});

		// These are rejected by hostname validation before any lookup happens.
		it("rejects bracketed IPv6 literals", async () => {
			await expect(isURLLocal(new URL("http://[::1]"))).rejects.toThrow("Invalid hostname");
		});

		it("rejects labels starting with a hyphen", async () => {
			await expect(isURLLocal(new URL("http://--1.sslip.io"))).rejects.toThrow("Invalid hostname");
		});

		it("rejects labels with non-alphanumeric characters", async () => {
			await expect(isURLLocal(new URL("http://foo_bar.example"))).rejects.toThrow(
				"Invalid hostname"
			);
		});

		it("rejects labels longer than 63 characters", async () => {
			await expect(isURLLocal(new URL(`http://${"a".repeat(64)}.example`))).rejects.toThrow(
				"Invalid hostname"
			);
		});
	});
});

describe("isHostLocalhost", () => {
	it.each([
		["localhost", true],
		["::1", true],
		["[::1]", true],
		["127.0.0.1", true],
		["127.254.254.254", true],
		["app.localhost", true],
		["huggingface.co", false],
		["127.example.com", false],
		["10.0.0.1", false],
	])("%s -> %s", (host, expected) => {
		expect(isHostLocalhost(host)).toBe(expected);
	});
});
