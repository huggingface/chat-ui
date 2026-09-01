<script lang="ts">
	import { sidePane } from "$lib/stores/sidePane.svelte";
	import { subscribeToTheme } from "$lib/switchTheme";
	import SidePane from "./SidePane.svelte";

	import type { PaneItem } from "$lib/utils/paneItems";
	import { TRACKIO_FRAME_SANDBOX } from "$lib/utils/trackio";
	import PaneItemNav from "./PaneItemNav.svelte";

	import CarbonChartLine from "~icons/carbon/chart-line";
	import CarbonCloseLarge from "~icons/carbon/close-large";
	import CarbonLaunch from "~icons/carbon/launch";
	import CarbonRenew from "~icons/carbon/renew";

	/**
	 * Live Trackio dashboard for a training run, framed in the side pane.
	 *
	 * Unlike an artifact preview this is a real cross-origin document, not
	 * generated content in a `srcdoc`, so the sandbox is different by necessity:
	 * a Trackio Space needs `allow-same-origin` to reach its own storage and
	 * backend, which `PREVIEW_SANDBOX` deliberately withholds from artifacts.
	 * Granting it here is safe precisely because the framed origin is never
	 * chat-ui's — `*.hf.space` only, enforced when the URL is extracted (see
	 * `$lib/utils/trackio`). What the sandbox still buys us is the default deny
	 * on top-level navigation: an embedded Space cannot navigate the tab away.
	 */

	interface Props {
		/**
		 * Everything the pane can show for this conversation, in order. Drives the
		 * cross-item nav in the header, and is also how the view notices its own
		 * dashboard is gone — a dashboard that left the visible message path is no
		 * longer in the list.
		 */
		items: PaneItem[];
	}

	let { items }: Props = $props();

	let dashboard = $derived(sidePane.trackio);
	let present = $derived(
		!!dashboard && items.some((item) => item.kind === "trackio" && item.url === dashboard?.url)
	);

	/**
	 * Close the pane when its dashboard is no longer on the visible message path
	 * (branch switch, message edit). Debounced for the same reason the artifact
	 * pane debounces: the registry can have transient gaps while a finished
	 * generation is invalidated and refetched, and those must not close it.
	 */
	$effect(() => {
		if (sidePane.open && sidePane.view === "trackio" && dashboard && !present) {
			const timer = setTimeout(() => sidePane.close(), 300);
			return () => clearTimeout(timer);
		}
	});

	// Follow chat-ui's resolved light/dark, so the framed dashboard doesn't sit in
	// light mode inside a dark app. `subscribeToTheme` fires immediately with the
	// current state and again on every toggle, and returns its own unsubscribe.
	let isDark = $state(false);
	$effect(() => subscribeToTheme((theme) => (isDark = theme.isDark)));

	/**
	 * The framed URL, with the two display parameters the pane wants:
	 *
	 * - `sidebar=hidden` — Trackio's own embed parameter. The pane is narrower
	 *   than a full tab and already names the run in its header, so the charts
	 *   get the width instead of the project/run picker.
	 * - `__theme` — Gradio's theme override, which Trackio inherits by being a
	 *   Gradio app. Read at page load, so a toggle necessarily reloads the frame
	 *   (and drops in-dashboard state like an expanded section); a theme change
	 *   is rare enough that matching the app is worth it.
	 *
	 * Built through `URLSearchParams` rather than string concatenation because the
	 * extracted URL may already carry a query (see `$lib/utils/trackio`).
	 */
	let frameUrl = $derived.by(() => {
		if (!dashboard) return undefined;
		try {
			const url = new URL(dashboard.url);
			url.searchParams.set("sidebar", "hidden");
			url.searchParams.set("__theme", isDark ? "dark" : "light");
			return url.toString();
		} catch {
			return dashboard.url;
		}
	});

	/**
	 * Remount key for the manual reload. The dashboard polls on its own, so this
	 * is for the case where the Space was still building when the pane opened and
	 * the frame is showing a build page that will never become the app.
	 */
	let reloadNonce = $state(0);
</script>

{#if sidePane.open && sidePane.view === "trackio" && dashboard}
	<SidePane label="Training dashboard">
		{#snippet children(resizing)}
			<header
				class="relative z-10 flex h-12 flex-none items-center gap-2 border-b border-gray-100 px-3 dark:border-gray-800"
			>
				<PaneItemNav {items} />
				<div class="flex min-w-0 flex-1 items-baseline gap-2">
					<h2 class="flex-none text-sm font-semibold text-gray-800 dark:text-gray-200">
						Training dashboard
					</h2>
					<span class="truncate font-mono text-xs text-gray-400 dark:text-gray-500">
						{dashboard.label}
					</span>
				</div>

				<div class="flex flex-none items-center gap-0.5 text-gray-500 dark:text-gray-400">
					<button
						type="button"
						class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						title="Reload the dashboard"
						onclick={() => (reloadNonce += 1)}
					>
						<CarbonRenew />
					</button>
					<!-- The URL is allowlisted to *.hf.space at extraction, so this opens
					     directly instead of going through the external-link confirm the
					     artifact previews need for model-supplied hrefs. -->
					<a
						href={dashboard.url}
						target="_blank"
						rel="noopener noreferrer"
						class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						title="Open dashboard in a new tab"
					>
						<CarbonLaunch />
					</a>
					<button
						type="button"
						class="ml-0.5 btn rounded-md p-1 text-base hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						title="Close panel (Esc)"
						onclick={() => sidePane.close()}
					>
						<CarbonCloseLarge />
					</button>
				</div>
			</header>

			<div class="relative min-h-0 flex-1 bg-white dark:bg-gray-900">
				<!-- Sits BEHIND the frame rather than being toggled on a load event.
				     Trackio serves a bare `<div id="app">` shell, so `load` fires well
				     before anything is painted, and a Space that is still building
				     shows nothing at all for a while. An unpainted iframe is
				     transparent (the frame below deliberately sets no background), so
				     this shows through for exactly as long as there is nothing to see
				     and is covered the moment the dashboard paints its own background.
				     No timers, no readiness guessing, and it comes back by itself on
				     reload or a theme change. -->
				<div
					class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center"
					role="status"
					aria-live="polite"
				>
					<span
						class="trackio-pulse flex size-11 items-center justify-center rounded-xl
						bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
					>
						<CarbonChartLine class="text-xl" />
					</span>
					<div class="flex flex-col gap-1">
						<p class="text-sm font-medium text-gray-600 dark:text-gray-300">
							Starting the dashboard
						</p>
						<p class="max-w-xs text-xs text-gray-400 dark:text-gray-500">
							Trackio Spaces can take a minute to build on the first run. Metrics appear as soon as
							it is up.
						</p>
					</div>
					<span class="font-mono text-xxs text-gray-300 dark:text-gray-600">{dashboard.label}</span>
				</div>
				{#key `${frameUrl}:${reloadNonce}`}
					<iframe
						title="Trackio dashboard"
						class="relative h-full w-full {resizing ? 'pointer-events-none' : ''}"
						src={frameUrl}
						sandbox={TRACKIO_FRAME_SANDBOX}
						allowfullscreen
						referrerpolicy="no-referrer"
					></iframe>
				{/key}
			</div>
		{/snippet}
	</SidePane>
{/if}

<style>
	/* Breathing rather than spinning: the wait is a minute-scale build, not a
	   request in flight, and a spinner at that duration reads as stuck. */
	.trackio-pulse {
		animation: trackio-pulse 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
	}

	@keyframes trackio-pulse {
		0%,
		100% {
			opacity: 0.55;
			transform: scale(0.96);
		}
		50% {
			opacity: 1;
			transform: scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.trackio-pulse {
			animation: none;
			opacity: 0.8;
		}
	}
</style>
