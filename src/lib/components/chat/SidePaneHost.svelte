<script lang="ts">
	import type { Snippet } from "svelte";
	import { isKeepAliveTab, sidePane } from "$lib/stores/sidePane.svelte";
	import type { PaneItem } from "$lib/utils/paneItems";
	import type { PaperRef } from "$lib/utils/paper";
	import SidePane from "./SidePane.svelte";
	import PaneTabStrip from "./PaneTabStrip.svelte";
	import TrackioPane from "./TrackioPane.svelte";
	import WorkflowPane from "./WorkflowPane.svelte";
	import PaperPane from "./PaperPane.svelte";

	interface Props {
		items: PaneItem[];
		papers: PaperRef[];
		/** whether selections in a paper can be sent to chat */
		canQuote: boolean;
		/**
		 * The views that only ever show one thing at a time (artifact, resources,
		 * review). Each gates itself on the active tab, so only the showing one
		 * renders; they are passed in because their props live with the chat.
		 */
		views: Snippet<[boolean]>;
	}

	let { items, papers, canQuote, views }: Props = $props();

	/**
	 * The side pane: one frame, a tab strip, and the open tabs' views.
	 *
	 * Live documents — a Trackio dashboard, a workflow Space, a PDF — stay
	 * mounted while their tab is in the background (up to KEEP_ALIVE_LIMIT), so
	 * switching back does not reload a dashboard or lose your place in a paper.
	 * They are hidden with `visibility`, not `display: none`, which would drop a
	 * scroll position and measure a PDF's width as zero.
	 */
	let active = $derived(sidePane.active);
</script>

{#if sidePane.open && active}
	<SidePane label="Side panel" escapeDisabled={sidePane.escapeBlocked}>
		{#snippet children(resizing)}
			<PaneTabStrip {items} />
			<div class="relative min-h-0 flex-1">
				{#each sidePane.mountedKeepAlive as tab (tab.id)}
					{@const showing = tab.id === sidePane.activeId}
					<div
						class="absolute inset-0 flex flex-col"
						style={showing ? "" : "visibility: hidden; pointer-events: none; z-index: -1;"}
						aria-hidden={!showing}
						inert={!showing}
					>
						{#if tab.kind === "trackio"}
							<TrackioPane {tab} {items} {resizing} />
						{:else if tab.kind === "workflow"}
							<WorkflowPane {tab} {items} {resizing} active={showing} />
						{:else if tab.kind === "paper"}
							<PaperPane {tab} {papers} {canQuote} active={showing} />
						{/if}
					</div>
				{/each}
				{#if !isKeepAliveTab(active)}
					<div class="absolute inset-0 flex flex-col bg-white dark:bg-gray-900">
						{@render views(resizing)}
					</div>
				{/if}
			</div>
		{/snippet}
	</SidePane>
{/if}
