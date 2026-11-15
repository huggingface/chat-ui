import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCallDeadline } from "./httpClient";

describe("createCallDeadline", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("aborts once the server has been silent for the timeout", () => {
		const deadline = createCallDeadline(1_000);

		vi.advanceTimersByTime(999);
		expect(deadline.signal.aborted).toBe(false);

		vi.advanceTimersByTime(1);
		expect(deadline.signal.aborted).toBe(true);
		expect(String(deadline.signal.reason)).toContain("1000ms");
	});

	it("does not run while a user is being asked something", () => {
		// The whole point: a slow answer must not kill the call waiting on it.
		const deadline = createCallDeadline(1_000);

		deadline.pause();
		vi.advanceTimersByTime(60_000);
		expect(deadline.signal.aborted).toBe(false);

		deadline.resume();
		vi.advanceTimersByTime(999);
		expect(deadline.signal.aborted).toBe(false);

		vi.advanceTimersByTime(1);
		expect(deadline.signal.aborted).toBe(true);
	});

	it("stays stopped until the last prompt is answered", () => {
		// One call can be asked more than one thing before it finishes.
		const deadline = createCallDeadline(1_000);

		deadline.pause();
		deadline.pause();
		deadline.resume();
		vi.advanceTimersByTime(5_000);
		expect(deadline.signal.aborted).toBe(false);

		deadline.resume();
		vi.advanceTimersByTime(1_000);
		expect(deadline.signal.aborted).toBe(true);
	});

	it("gives the server a fresh budget after each answer", () => {
		const deadline = createCallDeadline(1_000);

		vi.advanceTimersByTime(900);
		deadline.pause();
		deadline.resume();

		vi.advanceTimersByTime(900);
		expect(deadline.signal.aborted).toBe(false);
	});

	it("follows the caller's abort straight through", () => {
		const outer = new AbortController();
		const deadline = createCallDeadline(60_000, outer.signal);

		outer.abort("Aborted by user");

		expect(deadline.signal.aborted).toBe(true);
		expect(deadline.signal.reason).toBe("Aborted by user");
	});

	it("starts aborted when the caller already gave up", () => {
		const deadline = createCallDeadline(60_000, AbortSignal.abort("gone"));

		expect(deadline.signal.aborted).toBe(true);
	});

	it("stops firing once disposed", () => {
		const deadline = createCallDeadline(1_000);

		deadline.dispose();
		vi.advanceTimersByTime(60_000);

		expect(deadline.signal.aborted).toBe(false);
	});
});
