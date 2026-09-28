import { describe, it, expect } from "vitest";
import { shouldShowPendingPlaceholder } from "./pendingPlaceholder";

const assistant = (content: string) => ({ from: "assistant" as const, content });

describe("the placeholder for a request that has not started streaming", () => {
	it("fills the gap after a send, before the blank assistant message exists", () => {
		expect(
			shouldShowPendingPlaceholder({
				pending: true,
				resuming: false,
				lastMessage: assistant("the previous answer"),
			})
		).toBe(true);
	});

	it("gives way to the blank assistant message a send appends", () => {
		expect(
			shouldShowPendingPlaceholder({ pending: true, resuming: false, lastMessage: assistant("") })
		).toBe(false);
	});

	it("stays away while a parked call resumes", () => {
		// That message already carries the tool call, so the blank test above misses it.
		expect(
			shouldShowPendingPlaceholder({
				pending: true,
				resuming: true,
				lastMessage: assistant("the answer so far"),
			})
		).toBe(false);
	});

	it("is not drawn when nothing is pending", () => {
		expect(
			shouldShowPendingPlaceholder({ pending: false, resuming: false, lastMessage: undefined })
		).toBe(false);
	});
});
