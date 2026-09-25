import HarnessEventChip from "./HarnessEventChip.svelte";
import ChatMessage from "./ChatMessage.svelte";
import { render } from "vitest-browser-svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageUpdateType, type MessageHarnessEventUpdate } from "$lib/types/MessageUpdate";
import { mlRegistry } from "$lib/stores/mlRegistry.svelte";
import { sidePane } from "$lib/stores/sidePane.svelte";

const event = (over: Partial<MessageHarnessEventUpdate["events"][number]> = {}) => ({
	serviceId: "svc-1",
	kind: "job" as const,
	jobId: "0123456789abcdef01234567",
	name: "sft-smoke",
	from: "RUNNING",
	to: "ERROR",
	ranSeconds: 137,
	at: 0,
	...over,
});

const update = (events = [event()]): MessageHarnessEventUpdate => ({
	type: MessageUpdateType.HarnessEvent,
	events,
	text: "[Harness event, not part of this tool result]\nJob sft-smoke failed: ERROR after 2m17s.",
	afterToolUuid: "u1",
});

beforeEach(() => vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 })));

afterEach(() => {
	vi.unstubAllGlobals();
	sidePane.reset();
	mlRegistry.reset();
});

describe("the harness event chip", () => {
	it("says which service ended, how, and after how long, and opens the services list", () => {
		mlRegistry.bind("conv-1");
		const { container } = render(HarnessEventChip, {
			update: update([event(), event({ serviceId: "svc-2", name: "eval", to: "COMPLETED" })]),
		});

		const chips = [...container.querySelectorAll<HTMLButtonElement>("button.harness-event")];
		expect(chips.map((chip) => chip.textContent?.trim())).toEqual([
			"sft-smoke failed after 2m 17s",
			"eval completed after 2m 17s",
		]);
		expect(chips.map((chip) => chip.dataset.tone)).toEqual(["error", "completed"]);

		chips[0].click();
		expect(sidePane.open).toBe(true);
		expect(sidePane.view).toBe("registry");
	});

	it("shows the line without a way to open it where there is no registry, as on a share", () => {
		const { container } = render(HarnessEventChip, { update: update() });

		expect(container.querySelector("button.harness-event")).toBeNull();
		expect(container.querySelector("span.harness-event")?.textContent?.trim()).toBe(
			"sft-smoke failed after 2m 17s"
		);
	});
});

describe("a message told of an ended job mid-turn", () => {
	const call = (uuid: string) => ({
		type: "tool",
		subtype: "call",
		uuid,
		call: { name: "hf_fs", parameters: {} },
	});
	const result = (uuid: string) => ({
		type: "tool",
		subtype: "result",
		uuid,
		result: {
			status: 0,
			call: { name: "hf_fs", parameters: {} },
			outputs: [{ text: "ok" }],
			display: true,
		},
	});

	it("puts the chip between the round it followed and the next one", () => {
		const { container } = render(ChatMessage, {
			message: {
				id: "m1",
				from: "assistant",
				content: "",
				children: [],
				updates: [call("u1"), result("u1"), update(), call("u2"), result("u2")],
			},
			loading: true,
			isLast: true,
		} as never);

		const rows = [...container.querySelectorAll("code, .harness-event")].map((el) =>
			el.classList.contains("harness-event") ? "event" : "tool"
		);
		expect(rows).toEqual(["tool", "event", "tool"]);
	});

	it("keeps the chip visible once the turn is over", () => {
		const { container } = render(ChatMessage, {
			message: {
				id: "m1",
				from: "assistant",
				content: "Done.",
				children: [],
				updates: [
					call("u1"),
					result("u1"),
					update(),
					call("u2"),
					result("u2"),
					{ type: "finalAnswer", text: "Done.", interrupted: false },
				],
			},
			loading: false,
			isLast: true,
		} as never);

		expect(container.querySelector(".harness-event")?.textContent?.trim()).toBe(
			"sft-smoke failed after 2m 17s"
		);
	});
});
