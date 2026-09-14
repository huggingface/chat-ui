import type { TrackioSpaceStatus } from "$lib/server/trackioSpace";
import { base } from "$app/paths";

/** Brisk while the Space is expected imminently... */
const POLL_FAST_MS = 5_000;
/** ...then slow, because a queued job can wait hours before it even starts. */
const POLL_SLOW_MS = 30_000;
const SLOW_AFTER_MS = 2 * 60 * 1000;

/**
 * Polls whether a Trackio Space is up.
 *
 * The dashboard is named when the run starts but created by `trackio.init`,
 * which happens after the queue, the image pull, the installs and the imports —
 * so the chip is known long before it can be framed. Polling is server-side and
 * never enters the model's context.
 *
 * Elapsed time is deliberately never turned into a failure: a job can sit in a
 * queue for hours (the RTX PRO 6000 pool reaches eight), and a run that is
 * merely slow must not have its dashboard permanently disabled. Only the Hub's
 * own stage can say "failed".
 *
 * `status` is a pure read and `watch` is what starts the polling, because a
 * getter that started it would be mutating state inside a template expression.
 */
class TrackioStatusStore {
	#byUrl = $state<Record<string, TrackioSpaceStatus>>({});
	#timers = new Map<string, ReturnType<typeof setTimeout>>();
	/** Watchers per URL, so the last one to leave stops the polling. */
	#watchers = new Map<string, number>();

	status(url: string): TrackioSpaceStatus {
		return this.#byUrl[url] ?? "missing";
	}

	/**
	 * Idempotent per URL. Returns a stop function: call it from the effect's
	 * teardown, or the interval outlives the component that wanted it.
	 */
	watch(url: string, spaceId: string): () => void {
		this.#watchers.set(url, (this.#watchers.get(url) ?? 0) + 1);
		if (!this.#timers.has(url)) this.#start(url, spaceId);

		let released = false;
		return () => {
			if (released) return;
			released = true;
			const left = (this.#watchers.get(url) ?? 1) - 1;
			if (left > 0) return this.#watchers.set(url, left) && undefined;
			this.#watchers.delete(url);
			this.#stopTimer(url);
		};
	}

	#start(url: string, spaceId: string) {
		const startedAt = Date.now();
		const tick = async () => {
			try {
				const response = await fetch(
					`${base}/api/v2/trackio/status?space=${encodeURIComponent(spaceId)}`
				);
				if (response.ok) {
					const { json } = (await response.json()) as { json: { status: TrackioSpaceStatus } };
					this.#byUrl = { ...this.#byUrl, [url]: json.status };
					// Live and failed are terminal: nothing more to learn by asking.
					if (json.status === "live" || json.status === "failed") {
						this.#watchers.delete(url);
						return this.#stopTimer(url);
					}
				}
			} catch {
				// Offline or a blip: the next tick tries again.
			}
			if (!this.#watchers.has(url)) return;
			const delay = Date.now() - startedAt > SLOW_AFTER_MS ? POLL_SLOW_MS : POLL_FAST_MS;
			this.#timers.set(url, setTimeout(tick, delay));
		};
		// Marks the URL as watched before the first await, so a second watcher
		// within the same tick does not start a parallel loop.
		this.#timers.set(url, setTimeout(tick, 0));
	}

	#stopTimer(url: string) {
		const timer = this.#timers.get(url);
		if (timer) clearTimeout(timer);
		this.#timers.delete(url);
	}
}

export const trackioStatus = new TrackioStatusStore();
