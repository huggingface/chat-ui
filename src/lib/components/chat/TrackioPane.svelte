<script lang="ts">
	import { sidePane } from "$lib/stores/sidePane.svelte";
	import SidePane from "./SidePane.svelte";

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
	const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-downloads";

	let dashboard = $derived(sidePane.trackio);

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
				{#key `${dashboard.url}:${reloadNonce}`}
					<iframe
						title="Trackio dashboard"
						class="h-full w-full bg-white dark:bg-gray-900 {resizing ? 'pointer-events-none' : ''}"
						src={dashboard.url}
						sandbox={SANDBOX}
						allowfullscreen
						referrerpolicy="no-referrer"
					></iframe>
				{/key}
			</div>
		{/snippet}
	</SidePane>
{/if}
