import type { TrackioSpaceStatus } from "$lib/server/trackioSpace";
import { base } from "$app/paths";

/** Slow enough to be free, fast enough that a built Space is not stale on screen. */
const POLL_MS = 5_000;
/**
 * A Space that has not appeared within this long is one the run never reached —
 * the chip says so rather than spinning for the rest of the conversation.
 */
const GIVE_UP_MS = 30 * 60 * 1000;

type Tracked = { status: TrackioSpaceStatus; since: number };

/**
 * Polls whether a Trackio Space is up.
 *
 * The dashboard is named when the run starts but created by `trackio.init`,
 * which happens after the image pull, the installs and the imports — so the
 * chip is known long before it can be framed. Polling is server-side and never
 * enters the model's context.
 */
class TrackioStatusStore {
	#byUrl = $state<Record<string, Tracked>>({});
	#timers = new Map<string, ReturnType<typeof setInterval>>();

	status(url: string, spaceId: string): TrackioSpaceStatus {
		this.#ensure(url, spaceId);
		return this.#byUrl[url]?.status ?? "missing";
	}

	#ensure(url: string, spaceId: string) {
		if (this.#timers.has(url)) return;
		this.#byUrl = { ...this.#byUrl, [url]: { status: "missing", since: Date.now() } };
		const poll = async () => {
			const tracked = this.#byUrl[url];
			if (!tracked) return;
			if (Date.now() - tracked.since > GIVE_UP_MS) return this.#stop(url, "failed");
			try {
				const response = await fetch(
					`${base}/api/v2/trackio/status?space=${encodeURIComponent(spaceId)}`
				);
				if (!response.ok) return;
				const { json } = (await response.json()) as { json: { status: TrackioSpaceStatus } };
				this.#byUrl = { ...this.#byUrl, [url]: { ...tracked, status: json.status } };
				// Live and failed are both terminal for polling: nothing more to learn.
				if (json.status === "live" || json.status === "failed") this.#stop(url, json.status);
			} catch {
				// Offline or a blip: the next tick tries again.
			}
		};
		this.#timers.set(url, setInterval(poll, POLL_MS));
		void poll();
	}

	#stop(url: string, status: TrackioSpaceStatus) {
		const timer = this.#timers.get(url);
		if (timer) clearInterval(timer);
		this.#timers.delete(url);
		const tracked = this.#byUrl[url];
		if (tracked) this.#byUrl = { ...this.#byUrl, [url]: { ...tracked, status } };
	}
}

export const trackioStatus = new TrackioStatusStore();
