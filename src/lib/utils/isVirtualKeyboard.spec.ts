import { describe, expect, it } from "vitest";
import { detectVirtualKeyboard } from "./isVirtualKeyboard";

const DESKTOP_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const IPHONE_UA =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

describe("detectVirtualKeyboard", () => {
	it("returns true for a device with a coarse primary pointer (phone/tablet)", () => {
		expect(detectVirtualKeyboard({ hasCoarsePrimaryPointer: true, userAgent: IPHONE_UA })).toBe(
			true
		);
	});

	it("returns false for a touch-screen laptop (fine primary pointer, desktop UA)", () => {
		expect(detectVirtualKeyboard({ hasCoarsePrimaryPointer: false, userAgent: DESKTOP_UA })).toBe(
			false
		);
	});

	it("returns false for a regular desktop without touch", () => {
		expect(detectVirtualKeyboard({ hasCoarsePrimaryPointer: false, userAgent: DESKTOP_UA })).toBe(
			false
		);
	});

	it("falls back to the user agent when no coarse pointer is reported", () => {
		const oldAndroidUA =
			"Mozilla/5.0 (Linux; Android 4.4.2) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/30.0 Mobile Safari/537.36";
		expect(detectVirtualKeyboard({ hasCoarsePrimaryPointer: false, userAgent: oldAndroidUA })).toBe(
			true
		);
	});
});
