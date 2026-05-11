import { describe, it, expect } from "vitest";
import { isValidUrl } from "./urlSafety";

describe("isValidUrl", () => {
	it("allows normal HTTPS URLs", () => {
		expect(isValidUrl("https://example.com")).toBe(true);
		expect(isValidUrl("https://huggingface.co/docs")).toBe(true);
	});

	it("rejects HTTP URLs", () => {
		expect(isValidUrl("http://example.com")).toBe(false);
		expect(isValidUrl("http://169.254.170.23/v1/credentials")).toBe(false);
	});

	it("rejects localhost", () => {
		expect(isValidUrl("https://localhost")).toBe(false);
		expect(isValidUrl("https://localhost:3000")).toBe(false);
	});

	it("rejects private/internal IPs", () => {
		expect(isValidUrl("https://127.0.0.1")).toBe(false);
		expect(isValidUrl("https://192.168.1.1")).toBe(false);
		expect(isValidUrl("https://172.16.0.1")).toBe(false);
		expect(isValidUrl("https://169.254.170.23")).toBe(false);
	});

	it("allows 10.0.0.0/8 (used by internal LBs in cluster)", () => {
		expect(isValidUrl("https://10.0.0.1")).toBe(true);
		expect(isValidUrl("https://10.0.240.151")).toBe(true);
	});

	it("rejects non-URL strings", () => {
		expect(isValidUrl("not-a-url")).toBe(false);
		expect(isValidUrl("")).toBe(false);
		expect(isValidUrl("ftp://example.com")).toBe(false);
	});
});
