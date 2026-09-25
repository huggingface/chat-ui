import { handleResponse, useAPIClient } from "$lib/APIClient";
import type { MlFileListing } from "$lib/types/MlFile";
import type {
	MlRegistryArtefact,
	MlRegistryPayload,
	MlRegistryService,
	MlRegistrySummary,
} from "$lib/types/MlRegistry";
import { noteServerNow } from "$lib/utils/clockSkew.svelte";
import { isServiceOpen } from "$lib/utils/mlRegistry";

export const ML_REGISTRY_POLL_MS = 5_000;

type FetchFn = typeof globalThis.fetch;

/**
 * what the harness recorded for a conversation, read from the registry endpoint and nothing else
 * a stage changes between turns and the turn stream is keyed by message, so this polls, every
 * 5 s while a turn is live or a service is open, once when a turn ends or the pane opens
 */
export class MlRegistryStore {
	services = $state<MlRegistryService[]>([]);
	artefacts = $state<MlRegistryArtefact[]>([]);
	files = $state<MlFileListing[]>([]);
	/** the server clock on the last payload, effects reseed from it */
	serverNow = $state<number | undefined>(undefined);
	/** whether a payload has arrived for the current conversation */
	loaded = $state(false);

	/** the conversation the rows belong to, undefined once it is left */
	conversationId = $state<string | undefined>(undefined);

	#live = false;
	#watching = false;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#inflight: Promise<void> | undefined;
	/** bumped by every reset, so a request started before one lands nowhere */
	#epoch = 0;
	readonly #fetcher: FetchFn | undefined;

	/** the fetch is injectable so a spec never opens a socket */
	constructor(fetcher?: FetchFn) {
		this.#fetcher = fetcher;
	}

	get openServices(): MlRegistryService[] {
		return this.services.filter(isServiceOpen);
	}

	get summary(): MlRegistrySummary {
		return {
			// files join the count once the pane lists them
			rows: this.services.length + this.artefacts.length,
			open: this.openServices.length,
			running: this.services.filter((service) => service.stage === "RUNNING").length,
		};
	}

	/**
	 * keeps the registry current while the caller effect lives, live is whether a turn is
	 * running and a flip to not live is the turn ending, worth one immediate refetch
	 */
	watch(conversationId: string, { live }: { live: boolean }): () => void {
		this.bind(conversationId);
		const turnEnded = this.#live && !live;
		this.#live = live;
		this.#watching = true;
		if (!this.loaded || turnEnded) void this.refresh();
		this.#reschedule();
		return () => {
			this.#watching = false;
			this.#stopTimer();
		};
	}

	/** one fetch shared with any already in flight, a failure waits for the next tick */
	refresh(): Promise<void> {
		const conversationId = this.conversationId;
		if (!conversationId) return Promise.resolve();
		if (this.#inflight) return this.#inflight;
		const epoch = this.#epoch;
		this.#inflight = (async () => {
			try {
				const payload = await this.#load(conversationId);
				if (this.#epoch === epoch) this.apply(payload);
			} catch {
				// offline or a blip, the next tick tries again
			} finally {
				// a reset in between has already handed the slot to the next conversation
				if (this.#epoch === epoch) {
					this.#inflight = undefined;
					this.#reschedule();
				}
			}
		})();
		return this.#inflight;
	}

	apply(payload: MlRegistryPayload): void {
		this.services = payload.services;
		this.artefacts = payload.artefacts;
		this.files = payload.files;
		this.serverNow = payload.serverNow;
		this.loaded = true;
		noteServerNow(payload.serverNow);
	}

	reset(): void {
		this.#stopTimer();
		this.#epoch += 1;
		this.#inflight = undefined;
		this.conversationId = undefined;
		this.#live = false;
		this.#watching = false;
		this.services = [];
		this.artefacts = [];
		this.files = [];
		this.serverNow = undefined;
		this.loaded = false;
	}

	/** binds without fetching, a different conversation starts clean */
	bind(conversationId: string): void {
		if (this.conversationId === conversationId) return;
		this.reset();
		this.conversationId = conversationId;
	}

	#reschedule() {
		this.#stopTimer();
		if (!this.#watching) return;
		if (!this.#live && this.openServices.length === 0) return;
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			void this.refresh();
		}, ML_REGISTRY_POLL_MS);
	}

	#stopTimer() {
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = undefined;
	}

	async #load(conversationId: string): Promise<MlRegistryPayload> {
		const client = useAPIClient(this.#fetcher ? { fetch: this.#fetcher } : {});
		const response = await client.conversations({ id: conversationId }).registry.get();
		return handleResponse(response) as MlRegistryPayload;
	}
}

export const mlRegistry = new MlRegistryStore();
