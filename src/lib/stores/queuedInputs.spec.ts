import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedInputView } from "$lib/types/QueuedInput";

vi.mock("$app/paths", () => ({ base: "" }));

const { QUEUE_POLL_MS, QueuedInputsStore } = await import("./queuedInputs.svelte");

const view = (id: string, status: QueuedInputView["status"] = "queued"): QueuedInputView => ({
	id,
	text: `text ${id}`,
	status,
	createdAt: 0,
});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("QueuedInputsStore", () => {
	it("shows a queued message at once and swaps in the server's row", async () => {
		let answer: (response: Response) => void = () => {};
		const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) =>
			init?.method === "POST"
				? new Promise<Response>((resolve) => (answer = resolve))
				: json({ inputs: [] })
		);
		const store = new QueuedInputsStore(fetchFn as unknown as typeof fetch);
		store.watch("c1", { busy: true, onStarted: () => {} });

		const sent = store.enqueue("use lr 1e-4");
		expect(store.items).toMatchObject([{ text: "use lr 1e-4", sending: true }]);
		answer(json({ input: view("q1") }));

		expect(await sent).toBe("queued");
		expect(store.items).toEqual([view("q1")]);
		expect(fetchFn).toHaveBeenCalledWith(
			"/conversation/c1/queue",
			expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "use lr 1e-4" }) })
		);
	});

	it("drops the chip and reports a refused message", async () => {
		const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) =>
			init?.method === "POST" ? json({}, 429) : json({ inputs: [] })
		);
		const store = new QueuedInputsStore(fetchFn as unknown as typeof fetch);
		store.watch("c1", { busy: true, onStarted: () => {} });

		expect(await store.enqueue("too many")).toBe("failed");
		expect(store.items).toEqual([]);
	});

	it("drops what the running turn reports reading", async () => {
		const fetchFn = vi.fn(async () => json({ inputs: [view("q1"), view("q2")] }));
		const store = new QueuedInputsStore(fetchFn as unknown as typeof fetch);
		store.watch("c1", { busy: true, onStarted: () => {} });
		await vi.waitFor(() => expect(store.items).toHaveLength(2));

		store.delivered(new Set(["q1"]));

		expect(store.items.map((item) => item.id)).toEqual(["q2"]);
	});

	it("tells a remove that lost to the turn apart from a cancel", async () => {
		const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
			if (init?.method !== "DELETE") return json({ inputs: [view("q1"), view("q2")] });
			const { id } = JSON.parse(String(init.body));
			return id === "q1" ? json({ cancelled: true }) : json({ cancelled: false }, 409);
		});
		const store = new QueuedInputsStore(fetchFn as unknown as typeof fetch);
		store.watch("c1", { busy: true, onStarted: () => {} });
		await vi.waitFor(() => expect(store.items).toHaveLength(2));

		expect(await store.remove("q1")).toBe("cancelled");
		expect(await store.remove("q2")).toBe("sent");
		expect(store.items).toEqual([]);
	});

	it("polls once the turn ends and hands over when the server started the next turn", async () => {
		const responses = [
			{ inputs: [view("q1")] },
			{ inputs: [view("q1")] },
			{ inputs: [view("q1", "started")] },
		];
		const fetchFn = vi.fn(async () => json(responses.shift() ?? { inputs: [] }));
		const onStarted = vi.fn();
		const store = new QueuedInputsStore(fetchFn as unknown as typeof fetch);
		store.watch("c1", { busy: true, onStarted });
		await vi.waitFor(() => expect(store.items).toHaveLength(1));

		store.watch("c1", { busy: false, onStarted });
		await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS);
		expect(onStarted).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS);

		expect(onStarted).toHaveBeenCalledTimes(1);
		expect(store.items).toEqual([]);
		await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS * 3);
		expect(fetchFn).toHaveBeenCalledTimes(3);
	});

	it("does not poll while the turn is busy", async () => {
		const fetchFn = vi.fn(async () => json({ inputs: [view("q1")] }));
		const store = new QueuedInputsStore(fetchFn as unknown as typeof fetch);
		store.watch("c1", { busy: true, onStarted: () => {} });
		await vi.waitFor(() => expect(store.items).toHaveLength(1));

		await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS * 5);

		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("gives back only what the stop cancelled, not what a turn took first", async () => {
		const fetchFn = vi.fn(async () => json({ inputs: [view("q1"), view("q2")] }));
		const store = new QueuedInputsStore(fetchFn as unknown as typeof fetch);
		store.watch("c1", { busy: true, onStarted: () => {} });
		await vi.waitFor(() => expect(store.items).toHaveLength(2));

		store.takeBack();
		expect(store.items).toEqual([]);
		expect(store.returned).toEqual([]);
		store.stopped(["q2"]);

		expect(store.takeReturned()).toEqual([{ text: "text q2" }]);
		expect(store.returned).toEqual([]);
	});

	it("lets a stop wait for an insert in flight and gives it back once cancelled", async () => {
		let answer: (response: Response) => void = () => {};
		const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) =>
			init?.method === "POST"
				? new Promise<Response>((resolve) => (answer = resolve))
				: json({ inputs: [] })
		);
		const store = new QueuedInputsStore(fetchFn as unknown as typeof fetch);
		store.watch("c1", { busy: true, onStarted: () => {} });

		const sent = store.enqueue("late");
		store.takeBack();
		let settled = false;
		const waiting = store.settled().then(() => (settled = true));
		await Promise.resolve();
		expect(settled).toBe(false);

		answer(json({ input: view("q9") }));
		expect(await sent).toBe("withdrawn");
		await waiting;
		store.stopped(["q9"]);
		expect(store.takeReturned()).toEqual([{ text: "late" }]);
	});

	it("cancels an insert that lands after the stop answered and gives it back", async () => {
		let answer: (response: Response) => void = () => {};
		const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
			if (init?.method === "POST") return new Promise<Response>((resolve) => (answer = resolve));
			if (init?.method === "DELETE") return json({ cancelled: true });
			return json({ inputs: [] });
		});
		const store = new QueuedInputsStore(fetchFn as unknown as typeof fetch);
		store.watch("c1", { busy: true, onStarted: () => {} });

		const sent = store.enqueue("very late");
		store.takeBack();
		store.stopped([]);
		answer(json({ input: view("q9") }));

		expect(await sent).toBe("withdrawn");
		await vi.waitFor(() => expect(store.returned).toEqual([{ text: "very late" }]));
		expect(fetchFn).toHaveBeenCalledWith(
			"/conversation/c1/queue",
			expect.objectContaining({ method: "DELETE", body: JSON.stringify({ id: "q9" }) })
		);
	});

	it("gives back a send that failed after a stop took it back", async () => {
		let answer: (response: Response) => void = () => {};
		const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) =>
			init?.method === "POST"
				? new Promise<Response>((resolve) => (answer = resolve))
				: json({ inputs: [] })
		);
		const store = new QueuedInputsStore(fetchFn as unknown as typeof fetch);
		store.watch("c1", { busy: true, onStarted: () => {} });

		const sent = store.enqueue("never queued");
		store.takeBack();
		answer(json({}, 500));

		expect(await sent).toBe("withdrawn");
		expect(store.takeReturned()).toEqual([{ text: "never queued" }]);
	});

	it("gives back a message no turn could start, with the reason", async () => {
		const responses = [
			{ inputs: [view("q1")] },
			{ inputs: [{ ...view("q1", "failed"), error: "rate limited" }] },
		];
		const fetchFn = vi.fn(async () => json(responses.shift() ?? { inputs: [] }));
		const store = new QueuedInputsStore(fetchFn as unknown as typeof fetch);
		store.watch("c1", { busy: false, onStarted: () => {} });
		await vi.waitFor(() => expect(store.items).toHaveLength(1));

		await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS);

		expect(store.items).toEqual([]);
		expect(store.takeReturned()).toEqual([{ text: "text q1", error: "rate limited" }]);
	});

	it("forgets the last conversation's queue on navigation", async () => {
		const fetchFn = vi.fn(async (url: unknown) =>
			json({ inputs: String(url).includes("c1") ? [view("q1")] : [] })
		);
		const store = new QueuedInputsStore(fetchFn as unknown as typeof fetch);
		store.watch("c1", { busy: true, onStarted: () => {} });
		await vi.waitFor(() => expect(store.items).toHaveLength(1));

		store.watch("c2", { busy: true, onStarted: () => {} });

		expect(store.items).toEqual([]);
		expect(store.conversationId).toBe("c2");
	});
});
