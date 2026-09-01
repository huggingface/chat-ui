import {
	findHfHubMention,
	replaceHfHubMention,
	searchHfHub,
	type HfHubMention,
	type HfHubResource,
} from "$lib/utils/hfHubSearch";

/**
 * The @-mention autocomplete's state machine, kept out of `ChatInput` so the
 * races in it can be tested directly: the debounce, the stale-response guard,
 * accept-versus-send precedence, and every path that has to close the panel.
 *
 * `null` status means closed. There is deliberately no "idle" — the panel is
 * open exactly when there is a status to show, so an unrenderable fourth state
 * cannot exist.
 */
export type HubSearchStatus = "loading" | "success" | "error" | null;

/** Below this, a query matches most of the Hub and the results are noise. */
export const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

export interface HubMentionOptions {
	/** Off for self-hosted deployments, which must not call huggingface.co. */
	enabled: boolean;
	/** Injectable for tests. */
	search?: typeof searchHfHub;
	debounceMs?: number;
}

export class HubMentionState {
	mention = $state<HfHubMention | null>(null);
	results = $state<HfHubResource[]>([]);
	status = $state<HubSearchStatus>(null);
	/**
	 * -1 means "nothing chosen". Enter only accepts once the user has arrowed
	 * into the list, so an ordinary `@name` in prose never swallows a send.
	 */
	activeIndex = $state(-1);

	#enabled: boolean;
	#search: typeof searchHfHub;
	#debounceMs: number;
	#timeout: ReturnType<typeof setTimeout> | null = null;
	#abort: AbortController | null = null;
	#sequence = 0;
	/**
	 * The mention text the user dismissed or just accepted. Without it, the
	 * caret landing inside a completed `@org/model` re-opens the panel and
	 * searches for the id that was only just inserted, and Escape is undone by
	 * the next click.
	 */
	#suppressed: string | null = null;

	constructor(options: HubMentionOptions) {
		this.#enabled = options.enabled;
		this.#search = options.search ?? searchHfHub;
		this.#debounceMs = options.debounceMs ?? DEBOUNCE_MS;
	}

	get open(): boolean {
		return this.status !== null;
	}

	/** The result Enter would accept, or undefined when nothing is chosen. */
	get activeResult(): HfHubResource | undefined {
		return this.activeIndex >= 0 ? this.results[this.activeIndex] : undefined;
	}

	/**
	 * Re-evaluate against the textarea's current text and caret. Safe to call
	 * from every event that can move the caret; it only starts a request when
	 * the query actually changed.
	 */
	update(value: string, caret: number | null): void {
		if (!this.#enabled) return;

		const next = findHfHubMention(value, caret ?? value.length);
		if (!next || next.query.length < MIN_QUERY_LENGTH) {
			this.reset();
			return;
		}
		// Re-entering a mention that was dismissed or already accepted must not
		// re-open the panel; typing more of it is a new query and may.
		if (this.#suppressed !== null && next.query === this.#suppressed) {
			this.mention = null;
			return;
		}
		this.#suppressed = null;

		const queryChanged = next.query !== this.mention?.query;
		this.mention = next;
		if (!queryChanged && this.status !== null) return;

		this.#startSearch(next.query);
	}

	/**
	 * Close if `value` no longer contains the mention being tracked. Covers
	 * every programmatic write the textarea never reports — above all
	 * `ChatWindow` clearing the draft on submit, which would otherwise leave the
	 * panel hovering over an empty composer and later insert into it.
	 */
	syncValue(value: string): void {
		const mention = this.mention;
		if (!mention) return;
		if (value.slice(mention.start, mention.end) !== `@${mention.query}`) this.reset();
	}

	/** Move the highlight, wrapping, and treat the list as explicitly entered. */
	move(delta: number): void {
		if (this.results.length === 0) return;
		const from = this.activeIndex < 0 ? (delta > 0 ? -1 : 0) : this.activeIndex;
		this.activeIndex = (from + delta + this.results.length) % this.results.length;
	}

	setActiveIndex(index: number): void {
		this.activeIndex = index;
	}

	/** Apply a result to the text, and suppress the mention it just completed. */
	accept(value: string, result: HfHubResource): { value: string; caret: number } | null {
		const mention = this.mention;
		if (!mention) return null;
		const replacement = replaceHfHubMention(value, mention, result.id);
		this.reset();
		this.#suppressed = result.id;
		return replacement;
	}

	/** Escape: close, and stay closed until the query changes. */
	dismiss(): void {
		const query = this.mention?.query ?? null;
		this.reset();
		this.#suppressed = query;
	}

	reset(): void {
		this.#sequence += 1;
		if (this.#timeout) {
			clearTimeout(this.#timeout);
			this.#timeout = null;
		}
		this.#abort?.abort();
		this.#abort = null;
		this.mention = null;
		this.results = [];
		this.status = null;
		this.activeIndex = -1;
	}

	destroy(): void {
		this.reset();
		this.#suppressed = null;
	}

	#startSearch(query: string): void {
		const sequence = ++this.#sequence;
		if (this.#timeout) clearTimeout(this.#timeout);
		this.#abort?.abort();
		this.#abort = null;
		this.results = [];
		this.activeIndex = -1;
		// Deliberately NOT `loading` yet: flipping it here would flash the panel
		// over the composer on every keystroke of ordinary typing, before the
		// debounce has even started.
		this.status = null;

		this.#timeout = setTimeout(async () => {
			this.#timeout = null;
			const controller = new AbortController();
			this.#abort = controller;
			if (sequence === this.#sequence) this.status = "loading";

			try {
				const results = await this.#search(query, controller.signal);
				if (sequence !== this.#sequence) return;
				this.results = results;
				this.status = "success";
			} catch (error) {
				if (controller.signal.aborted || sequence !== this.#sequence) return;
				console.error(error);
				this.results = [];
				this.status = "error";
			} finally {
				if (this.#abort === controller) this.#abort = null;
			}
		}, this.#debounceMs);
	}
}
