/**
 * Reactive connectivity store using Svelte 5 runes.
 *
 * `navigator.onLine` is only reliable when it reports `false` (definitely
 * offline); a `true` value merely means a network interface exists, not that
 * requests actually reach the server. It also fails to flip under DevTools'
 * Network "Offline" emulation once a service worker is controlling the page.
 *
 * So we probe once at startup to establish ground truth past that unreliable
 * initial value, then drive off the `online`/`offline` events (which fire
 * reliably on real transitions). The probe is a lightweight fetch to the
 * same-origin `/healthcheck` endpoint; the service worker serves that route
 * network-first, so it reflects real reachability (200 online, 503/throw
 * offline).
 */
import { browser } from "$app/environment";
import { base } from "$app/paths";

const PROBE_TIMEOUT_MS = 5_000;

class IsOnlineStore {
	#online = $state<boolean>(browser ? navigator.onLine : true);
	#probing = false;

	constructor() {
		if (!browser) return;

		// `offline` is trustworthy on its own; react immediately.
		window.addEventListener("offline", () => {
			this.#online = false;
		});
		// `online` only hints that connectivity *might* be back — verify it.
		window.addEventListener("online", () => void this.probe());

		// Re-check when the tab regains focus, in case state changed while hidden.
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible") void this.probe();
		});

		// One probe at startup to correct navigator.onLine's unreliable initial
		// value; transitions after that come from the events above.
		void this.probe();
	}

	/** Actively verify reachability by hitting the same-origin healthcheck. */
	async probe(): Promise<void> {
		if (!browser || this.#probing) return;

		// `navigator.onLine === false` is a reliable offline signal — skip the
		// round-trip and avoid a doomed fetch.
		if (!navigator.onLine) {
			this.#online = false;
			return;
		}

		this.#probing = true;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
		try {
			const res = await fetch(`${base}/healthcheck`, {
				method: "GET",
				cache: "no-store",
				signal: controller.signal,
			});
			this.#online = res.ok;
		} catch {
			this.#online = false;
		} finally {
			clearTimeout(timeout);
			this.#probing = false;
		}
	}

	get value(): boolean {
		return this.#online;
	}
}

let store: IsOnlineStore | undefined;

export function createIsOnlineStore(): IsOnlineStore {
	if (!store) {
		store = new IsOnlineStore();
	}
	return store;
}

export function useIsOnline(): IsOnlineStore {
	if (!store) {
		store = new IsOnlineStore();
	}
	return store;
}
