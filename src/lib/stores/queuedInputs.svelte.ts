import { base } from "$app/paths";
import type { QueuedInputView } from "$lib/types/QueuedInput";

export const QUEUE_POLL_MS = 2_000;
/** the server starts a leftover within a sweep or two, past this the poll gives up */
const POLL_GIVE_UP_MS = 2 * 60_000;

type FetchFn = typeof globalThis.fetch;

export type QueuedChip = QueuedInputView & { sending?: boolean };

// the turn reports what it read in its stream, leftovers become a server started turn this polls for
export class QueuedInputsStore {
	items = $state<QueuedChip[]>([]);
	conversationId = $state<string | undefined>(undefined);

	#busy = false;
	#onStarted: (() => void) | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#idleSince = 0;
	#generation = 0;
	#takenBack = 0;
	#sending = new Set<Promise<unknown>>();
	#fetch: FetchFn;

	constructor(fetchFn?: FetchFn) {
		this.#fetch = fetchFn ?? ((...args) => globalThis.fetch(...args));
	}

	#url(conversationId: string) {
		return `${base}/conversation/${conversationId}/queue`;
	}

	/** effect friendly, rerun it whenever busy changes */
	watch(
		conversationId: string,
		{ busy, onStarted }: { busy: boolean; onStarted: () => void }
	): () => void {
		this.#onStarted = onStarted;
		if (this.conversationId !== conversationId) {
			this.reset();
			this.conversationId = conversationId;
			void this.#load(this.#generation);
		}
		if (this.#busy !== busy) this.#idleSince = Date.now();
		this.#busy = busy;
		this.#schedule();
		return () => clearTimeout(this.#timer);
	}

	reset() {
		clearTimeout(this.#timer);
		this.#generation += 1;
		this.items = [];
		this.conversationId = undefined;
		this.#busy = false;
		this.#idleSince = Date.now();
	}

	#schedule() {
		clearTimeout(this.#timer);
		if (this.#busy || !this.conversationId) return;
		if (!this.items.some((item) => !item.sending)) return;
		if (Date.now() - this.#idleSince > POLL_GIVE_UP_MS) return;
		const generation = this.#generation;
		this.#timer = setTimeout(() => void this.#load(generation), QUEUE_POLL_MS);
	}

	async #load(generation: number) {
		const conversationId = this.conversationId;
		if (!conversationId) return;
		let inputs: QueuedInputView[] | undefined;
		try {
			const response = await this.#fetch(this.#url(conversationId));
			if (response.ok) ({ inputs } = (await response.json()) as { inputs: QueuedInputView[] });
		} catch {
			inputs = undefined;
		}
		if (generation !== this.#generation) return;
		if (!inputs) return this.#schedule();
		const byId = new Map(inputs.map((input) => [input.id, input]));
		const known = new Set(this.items.map((item) => item.id));
		const started = this.items.some((item) => byId.get(item.id)?.status === "started");
		this.items = [
			...this.items.filter((item) => item.sending || byId.get(item.id)?.status === "queued"),
			...inputs.filter((input) => input.status === "queued" && !known.has(input.id)),
		];
		if (started && !this.#busy) this.#onStarted?.();
		this.#schedule();
	}

	/** withdrawn when a stop took it back while it was in flight, the stop cancels it */
	async enqueue(text: string): Promise<"queued" | "failed" | "withdrawn"> {
		const conversationId = this.conversationId;
		if (!conversationId) return "failed";
		const generation = this.#generation;
		const takenBack = this.#takenBack;
		const temp: QueuedChip = {
			id: `pending-${crypto.randomUUID()}`,
			text,
			status: "queued",
			createdAt: Date.now(),
			sending: true,
		};
		this.items = [...this.items, temp];
		const request = this.#post(conversationId, text);
		this.#sending.add(request);
		const input = await request;
		this.#sending.delete(request);
		if (takenBack !== this.#takenBack) {
			if (input) void this.remove(input.id);
			return "withdrawn";
		}
		if (generation !== this.#generation) return input ? "queued" : "failed";
		if (!input) {
			this.items = this.items.filter((item) => item.id !== temp.id);
			return "failed";
		}
		this.items = this.items.map((item) => (item.id === temp.id ? input : item));
		this.#idleSince = Date.now();
		this.#schedule();
		return "queued";
	}

	async #post(conversationId: string, text: string): Promise<QueuedInputView | undefined> {
		try {
			const response = await this.#fetch(this.#url(conversationId), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text }),
			});
			if (!response.ok) return undefined;
			return ((await response.json()) as { input: QueuedInputView }).input;
		} catch {
			return undefined;
		}
	}

	/** a stop sent before an insert lands would leave that message queued behind it */
	async settled(timeoutMs = 5_000): Promise<void> {
		if (this.#sending.size === 0) return;
		await Promise.race([
			Promise.allSettled([...this.#sending]),
			new Promise((resolve) => setTimeout(resolve, timeoutMs)),
		]);
	}

	/** sent when the turn read it first, the chip goes either way */
	async remove(id: string): Promise<"cancelled" | "sent" | "error"> {
		const conversationId = this.conversationId;
		if (!conversationId) return "error";
		try {
			const response = await this.#fetch(this.#url(conversationId), {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id }),
			});
			if (response.status === 409) {
				this.items = this.items.filter((item) => item.id !== id);
				return "sent";
			}
			if (!response.ok) return "error";
			this.items = this.items.filter((item) => item.id !== id);
			return "cancelled";
		} catch {
			return "error";
		}
	}

	delivered(ids: ReadonlySet<string>) {
		if (!this.items.some((item) => ids.has(item.id))) return;
		this.items = this.items.filter((item) => !ids.has(item.id));
	}

	/** a stop cancels the queue on the server, the texts go back to the composer */
	takeBack(): string[] {
		this.#takenBack += 1;
		const texts = this.items.map((item) => item.text);
		this.items = [];
		clearTimeout(this.#timer);
		return texts;
	}
}

export const queuedInputs = new QueuedInputsStore();
