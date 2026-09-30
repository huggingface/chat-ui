<script lang="ts">
	import { sidePane } from "$lib/stores/sidePane.svelte";
	import SidePane from "./SidePane.svelte";

	import type { PaneItem } from "$lib/utils/paneItems";
	import PaneItemNav from "./PaneItemNav.svelte";

	import CarbonCloseLarge from "~icons/carbon/close-large";
	import CarbonLaunch from "~icons/carbon/launch";
	import CarbonMobile from "~icons/carbon/mobile";
	import CarbonRenew from "~icons/carbon/renew";

	/**
	 * A live Hugging Face Space framed in the side pane, e.g. the PaperPage workshop's dev server.
	 * Generic on purpose: anything that announces a `*.hf.space` preview through its own tool
	 * output (see `$lib/utils/spacePreview`) gets this view.
	 *
	 * Like TrackioPane this frames a real cross-origin app, so it keeps `allow-same-origin`; that is
	 * safe because only `*.hf.space` URLs taken from chat-ui's own tool output reach it. Popups are
	 * allowed so the page's own links (arXiv, code) open in a tab; top navigation stays denied.
	 */
	const FRAME_SANDBOX =
		"allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox";

	interface Props {
		/** everything the pane can show, for the header nav and to notice the preview left the path */
		items: PaneItem[];
	}

	let { items }: Props = $props();

	let preview = $derived(sidePane.space);
	let present = $derived(
		!!preview && items.some((item) => item.kind === "space" && item.url === preview?.url)
	);

	// closes when the preview's message left the visible path, debounced like the other views
	$effect(() => {
		if (sidePane.open && sidePane.view === "space" && preview && !present) {
			const timer = setTimeout(() => sidePane.close(), 300);
			return () => clearTimeout(timer);
		}
	});

	let reloadNonce = $state(0);
	/** phone-width frame, to check the page on mobile */
	let mobile = $state(false);
</script>

{#if sidePane.open && sidePane.view === "space" && preview}
	<SidePane label="Live preview">
		{#snippet children(resizing)}
			<header
				class="relative z-10 flex h-12 flex-none items-center gap-2 border-b border-gray-100 px-3 dark:border-gray-800"
			>
				<PaneItemNav {items} />
				<div class="flex min-w-0 flex-1 items-baseline gap-2">
					<h2 class="flex-none text-sm font-semibold text-gray-800 dark:text-gray-200">
						Live preview
					</h2>
					<span class="truncate font-mono text-xs text-gray-400 dark:text-gray-500">
						{preview.label}
					</span>
				</div>

				<div class="flex flex-none items-center gap-0.5 text-gray-500 dark:text-gray-400">
					<button
						type="button"
						class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						class:text-gray-900={mobile}
						class:dark:text-gray-100={mobile}
						title={mobile ? "Full width" : "Phone width"}
						aria-pressed={mobile}
						onclick={() => (mobile = !mobile)}
					>
						<CarbonMobile />
					</button>
					<button
						type="button"
						class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						title="Reload the preview"
						onclick={() => (reloadNonce += 1)}
					>
						<CarbonRenew />
					</button>
					<a
						href={preview.url}
						target="_blank"
						rel="noopener noreferrer"
						class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						title="Open in a new tab"
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

			<div class="relative flex min-h-0 flex-1 justify-center bg-gray-50 dark:bg-gray-950">
				<!-- behind the frame: shows through until the Space paints, like TrackioPane -->
				<p
					class="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-400"
					role="status"
				>
					Starting the preview…
				</p>
				{#key `${preview.url}:${reloadNonce}`}
					<iframe
						title="Live preview"
						class="relative h-full w-full {mobile
							? 'max-w-[390px] border-x border-gray-200 dark:border-gray-800'
							: ''} {resizing ? 'pointer-events-none' : ''}"
						src={preview.url}
						sandbox={FRAME_SANDBOX}
						allowfullscreen
						referrerpolicy="no-referrer"
					></iframe>
				{/key}
			</div>
		{/snippet}
	</SidePane>
{/if}
