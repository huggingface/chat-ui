<script lang="ts">
	import { DropdownMenu } from "bits-ui";
	import { sidePane, type PaneTab } from "$lib/stores/sidePane.svelte";
	import { paneItemTabId, type PaneItem } from "$lib/utils/paneItems";

	import CarbonAdd from "~icons/carbon/add";
	import CarbonChartLine from "~icons/carbon/chart-line";
	import CarbonClose from "~icons/carbon/close";
	import CarbonCloseLarge from "~icons/carbon/close-large";
	import CarbonCode from "~icons/carbon/code";
	import CarbonDocumentPdf from "~icons/carbon/document-pdf";
	import CarbonFlow from "~icons/carbon/flow";
	import CarbonFolder from "~icons/carbon/folder";
	import CarbonListChecked from "~icons/carbon/list-checked";

	interface Props {
		/** Everything this conversation can show, for labels and the "open" menu. */
		items: PaneItem[];
	}

	let { items }: Props = $props();

	const ICONS = {
		artifact: CarbonCode,
		trackio: CarbonChartLine,
		workflow: CarbonFlow,
		registry: CarbonFolder,
		review: CarbonListChecked,
		paper: CarbonDocumentPdf,
	} as const;

	let labels = $derived(new Map(items.map((item) => [paneItemTabId(item), item.label])));

	/** What a tab is called: the item's current label (artifacts get renamed), else its own. */
	function labelOf(tab: PaneTab): string {
		const fromItem = labels.get(tab.id);
		if (fromItem) return fromItem;
		switch (tab.kind) {
			case "artifact":
				return tab.identifier;
			case "trackio":
			case "workflow":
			case "paper":
				return tab.label;
			case "registry":
				return "Resources";
			case "review":
				return "Review";
		}
	}

	let closed = $derived(items.filter((item) => !sidePane.hasTab(paneItemTabId(item))));

	function openItem(item: PaneItem) {
		if (item.kind === "artifact") sidePane.openArtifact(item.identifier, null);
		else if (item.kind === "trackio") sidePane.openTrackio(item.url, item.label);
		else if (item.kind === "workflow") sidePane.openWorkflow(item);
		else sidePane.openPaper(item.paperId, item.label);
	}

	let strip = $state<HTMLDivElement>();
	// Keep the active tab in view when it changes from outside (a chip click).
	$effect(() => {
		const id = sidePane.activeId;
		if (!strip || !id) return;
		strip
			.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
	});

	function onTabKeydown(e: KeyboardEvent, index: number) {
		if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
		e.preventDefault();
		const next = sidePane.tabs[index + (e.key === "ArrowRight" ? 1 : -1)];
		if (!next) return;
		sidePane.activate(next.id);
		strip?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(next.id)}"] button`)?.focus();
	}
</script>

<div
	class="relative z-20 flex h-10 flex-none items-stretch border-b border-gray-100 bg-gray-50 pl-2 dark:border-gray-800 dark:bg-gray-950/60"
>
	<div
		bind:this={strip}
		class="no-scrollbar flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto pt-1.5"
		role="tablist"
		aria-label="Open in the side panel"
	>
		{#each sidePane.tabs as tab, index (tab.id)}
			{@const Icon = ICONS[tab.kind]}
			{@const isActive = tab.id === sidePane.activeId}
			{@const label = labelOf(tab)}
			<div
				data-tab-id={tab.id}
				class={[
					"group relative flex h-full max-w-48 min-w-0 flex-none items-center rounded-t-lg border border-b-0 text-xs",
					isActive
						? "border-gray-100 bg-white text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
						: "border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/60 dark:hover:text-gray-200",
				]}
			>
				<button
					type="button"
					role="tab"
					aria-selected={isActive}
					tabindex={isActive ? 0 : -1}
					class="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1 pl-2.5"
					title={label}
					onclick={() => sidePane.activate(tab.id)}
					onauxclick={(e) => {
						if (e.button === 1) sidePane.closeTab(tab.id);
					}}
					onkeydown={(e) => onTabKeydown(e, index)}
				>
					<Icon class="size-3.5 flex-none {isActive ? 'text-gray-500 dark:text-gray-400' : ''}" />
					<span class="truncate">{label}</span>
				</button>
				<button
					type="button"
					class={[
						"mr-1 flex size-5 flex-none items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200",
						isActive ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
					]}
					aria-label="Close {label}"
					title="Close tab"
					onclick={() => sidePane.closeTab(tab.id)}
				>
					<CarbonClose class="size-3.5" />
				</button>
			</div>
		{/each}
	</div>

	<div class="flex flex-none items-center gap-0.5 px-1.5 text-gray-500 dark:text-gray-400">
		{#if closed.length}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 data-[state=open]:bg-gray-200 dark:hover:bg-gray-800 dark:hover:text-gray-300 dark:data-[state=open]:bg-gray-700"
					aria-label="Open another item"
					title="Open another item from this conversation"
				>
					<CarbonAdd />
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content
						class="z-50 max-h-80 max-w-72 min-w-48 overflow-y-auto rounded-xl border border-gray-200 bg-white/95 p-1 text-gray-800 shadow-lg backdrop-blur-sm dark:border-gray-700/60 dark:bg-gray-800/95 dark:text-gray-100"
						side="bottom"
						align="end"
						sideOffset={4}
					>
						{#each closed as item (paneItemTabId(item))}
							{@const Icon = ICONS[item.kind]}
							<DropdownMenu.Item
								class="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-gray-700 select-none focus-visible:outline-hidden data-highlighted:bg-gray-100 dark:text-gray-200 dark:data-highlighted:bg-white/10"
								onSelect={() => openItem(item)}
							>
								<Icon class="size-3.5 flex-none text-gray-400" />
								<span class="truncate">{item.label}</span>
							</DropdownMenu.Item>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		{/if}
		<!-- close-large at text-base: the X glyph fills less of its viewBox than the
		     sibling icons, so it needs the bump to read as the same visual size -->
		<button
			type="button"
			class="btn rounded-md p-1 text-base hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
			title="Close panel (Esc)"
			onclick={() => sidePane.close()}
		>
			<CarbonCloseLarge />
		</button>
	</div>
</div>

<style>
	.no-scrollbar {
		scrollbar-width: none;
	}
	.no-scrollbar::-webkit-scrollbar {
		display: none;
	}
</style>
