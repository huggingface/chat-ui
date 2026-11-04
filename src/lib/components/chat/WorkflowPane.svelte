<script lang="ts">
	import { page } from "$app/state";
	import { sidePane } from "$lib/stores/sidePane.svelte";
	import { subscribeToTheme } from "$lib/switchTheme";
	import SidePane from "./SidePane.svelte";
	import PaneItemNav from "./PaneItemNav.svelte";

	import type { PaneItem } from "$lib/utils/paneItems";
	import { TRACKIO_FRAME_SANDBOX } from "$lib/utils/trackio";
	import { workflowTokenHandler } from "$lib/utils/workflowSpace";

	import CarbonFlow from "~icons/carbon/flow";
	import CarbonCloseLarge from "~icons/carbon/close-large";
	import CarbonLaunch from "~icons/carbon/launch";
	import CarbonRenew from "~icons/carbon/renew";

	/**
	 * A gr.Workflow Space `create_workflow` wrote, framed on its canvas. Framed
	 * like a Trackio dashboard (a real `*.hf.space` document, so the same
	 * sandbox), but it also answers the Space's requests for the visitor's
	 * tokens, as the Hub's own Space page does — see `workflowTokenHandler`.
	 */

	interface Props {
		/** Everything the pane can show; also how the view notices its workflow is gone. */
		items: PaneItem[];
	}

	let { items }: Props = $props();

	let workflow = $derived(sidePane.workflow);
	let present = $derived(
		!!workflow && items.some((item) => item.kind === "workflow" && item.url === workflow?.url)
	);

	// Debounced like the other views: the message list has transient gaps while a
	// finished generation is refetched, and those must not close the pane.
	$effect(() => {
		if (sidePane.open && sidePane.view === "workflow" && workflow && !present) {
			const timer = setTimeout(() => sidePane.close(), 300);
			return () => clearTimeout(timer);
		}
	});

	let isDark = $state(false);
	$effect(() => subscribeToTheme((theme) => (isDark = theme.isDark)));

	// `__theme` is read at page load, so a theme toggle reloads the frame.
	let frameUrl = $derived.by(() => {
		if (!workflow) return undefined;
		try {
			const url = new URL(workflow.url);
			url.searchParams.set("__theme", isDark ? "dark" : "light");
			return url.toString();
		} catch {
			return workflow.url;
		}
	});

	/** For a Space that was still building when the pane opened. */
	let reloadNonce = $state(0);

	let frame = $state<HTMLIFrameElement>();
	let origin = $derived.by(() => {
		try {
			return workflow ? new URL(workflow.url).origin : undefined;
		} catch {
			return undefined;
		}
	});

	// Listening before the frame loads matters: gradio sends its ZeroGPU handshake
	// once, as its client starts.
	$effect(() => {
		if (!workflow || !origin) return;
		const onMessage = workflowTokenHandler({
			frame: () => frame?.contentWindow,
			origin,
			spaceId: workflow.spaceId,
			viewer: page.data.user?.username,
		});
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	});
</script>

{#if sidePane.open && sidePane.view === "workflow" && workflow}
	<SidePane label="Workflow">
		{#snippet children(resizing)}
			<header
				class="@container relative z-10 flex h-12 flex-none items-center gap-2 border-b border-gray-100 px-3 dark:border-gray-800"
			>
				<PaneItemNav {items} />
				<div class="flex min-w-0 flex-1 items-baseline gap-2">
					<h2 class="min-w-0 truncate text-sm font-semibold text-gray-800 dark:text-gray-200">
						Workflow
					</h2>
					<span
						class="truncate font-mono text-xs text-gray-400 @max-[380px]:hidden dark:text-gray-500"
					>
						{workflow.label}
					</span>
				</div>

				<div class="flex flex-none items-center gap-0.5 text-gray-500 dark:text-gray-400">
					<button
						type="button"
						class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						title="Reload the workflow"
						onclick={() => (reloadNonce += 1)}
					>
						<CarbonRenew />
					</button>
					<!-- The URL is built from a *.hf.space Space id at extraction, so this
					     opens directly, without the external-link confirm. -->
					<a
						href={workflow.url}
						target="_blank"
						rel="noopener noreferrer"
						class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						title="Open the workflow in a new tab"
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
				<!-- Behind the frame, showing through until the canvas paints, as in TrackioPane. -->
				<div
					class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center"
					role="status"
					aria-live="polite"
				>
					<span
						class="workflow-pulse flex size-11 items-center justify-center rounded-xl bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
					>
						<CarbonFlow class="text-xl" />
					</span>
					<div class="flex flex-col gap-1">
						<p class="text-sm font-medium text-gray-600 dark:text-gray-300">
							Starting the workflow
						</p>
						<p class="max-w-xs text-xs text-gray-400 dark:text-gray-500">
							The Space takes a minute or two to build. The canvas appears as soon as it is up.
						</p>
					</div>
					<span class="font-mono text-xxs text-gray-300 dark:text-gray-600">{workflow.label}</span>
				</div>
				{#key `${frameUrl}:${reloadNonce}`}
					<iframe
						title="Workflow"
						class="relative h-full w-full {resizing ? 'pointer-events-none' : ''}"
						src={frameUrl}
						bind:this={frame}
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
	.workflow-pulse {
		animation: workflow-pulse 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
	}

	@keyframes workflow-pulse {
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
		.workflow-pulse {
			animation: none;
			opacity: 0.8;
		}
	}
</style>
