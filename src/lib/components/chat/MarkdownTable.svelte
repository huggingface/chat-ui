<script lang="ts">
	import { DropdownMenu } from "bits-ui";
	import { onDestroy } from "svelte";
	import Portal from "../Portal.svelte";
	import {
		extractTableData,
		saveFile,
		tableDataToCSV,
		tableDataToMarkdown,
		tableDataToTSV,
	} from "$lib/utils/tableData";
	import { confirm as hapticConfirm } from "$lib/utils/haptics";
	import CarbonCopy from "~icons/carbon/copy";
	import CarbonCheckmark from "~icons/carbon/checkmark";
	import CarbonDownload from "~icons/carbon/download";
	import CarbonMaximize from "~icons/carbon/maximize";
	import CarbonClose from "~icons/carbon/close";

	interface Props {
		/** `<table>` markup produced by the markdown pipeline (see marked.ts). */
		html: string;
	}

	let { html }: Props = $props();

	let inlineEl: HTMLDivElement | undefined = $state();
	let fullscreenEl: HTMLDivElement | undefined = $state();
	let fullscreen = $state(false);
	let copied = $state(false);
	let copiedTimeout: ReturnType<typeof setTimeout>;

	type Format = "md" | "csv" | "tsv";

	// Both views render the same markup, so read from whichever one is on screen.
	function currentTable(): HTMLTableElement | null {
		return (fullscreen ? fullscreenEl : inlineEl)?.querySelector("table") ?? null;
	}

	function serialize(format: Format): { content: string; mimeType: string } | undefined {
		const table = currentTable();
		if (!table) return undefined;
		const data = extractTableData(table);
		if (format === "csv") {
			return { content: tableDataToCSV(data), mimeType: "text/csv" };
		}
		if (format === "tsv") {
			return { content: tableDataToTSV(data), mimeType: "text/tab-separated-values" };
		}
		return { content: tableDataToMarkdown(data), mimeType: "text/markdown" };
	}

	async function copyAs(format: Format) {
		const table = currentTable();
		const serialized = serialize(format);
		if (!table || !serialized) return;

		try {
			// The table's HTML goes on the clipboard alongside the text so pasting into a
			// doc or a spreadsheet keeps the grid instead of landing in a single cell.
			if (window.isSecureContext && navigator.clipboard?.write && "ClipboardItem" in window) {
				await navigator.clipboard.write([
					new ClipboardItem({
						"text/plain": new Blob([serialized.content], { type: "text/plain" }),
						"text/html": new Blob([table.outerHTML], { type: "text/html" }),
					}),
				]);
			} else {
				await navigator.clipboard.writeText(serialized.content);
			}
			hapticConfirm();
			copied = true;
			clearTimeout(copiedTimeout);
			copiedTimeout = setTimeout(() => (copied = false), 1000);
		} catch (err) {
			console.error(err);
		}
	}

	function downloadAs(format: "csv" | "md") {
		const serialized = serialize(format);
		if (!serialized) return;
		saveFile(`table.${format}`, serialized.content, serialized.mimeType);
	}

	// The overlay is portalled to <body>, so marking the app inert keeps focus and
	// screen readers inside it while it is open. Escape is bound here rather than on
	// <svelte:window> so a conversation full of tables doesn't accumulate listeners.
	$effect(() => {
		if (!fullscreen) return;

		const app = document.getElementById("app");
		app?.setAttribute("inert", "true");
		const previouslyFocused = document.activeElement as HTMLElement | null;

		const onKeydown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				fullscreen = false;
			}
		};
		window.addEventListener("keydown", onKeydown, { capture: true });

		return () => {
			window.removeEventListener("keydown", onKeydown, { capture: true });
			app?.removeAttribute("inert");
			previouslyFocused?.focus();
		};
	});

	function focusOnMount(node: HTMLElement) {
		node.focus();
	}

	onDestroy(() => clearTimeout(copiedTimeout));

	const controlBtn =
		"rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-200/70 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200";
	const menuContent =
		"z-50 min-w-32 rounded-xl border border-gray-200 bg-white/95 p-1 text-gray-800 shadow-lg backdrop-blur-sm dark:border-gray-700/60 dark:bg-gray-800/95 dark:text-gray-100";
	const menuItem =
		"flex h-8 cursor-pointer items-center rounded-md px-2 text-sm select-none focus-visible:outline-hidden data-highlighted:bg-gray-100 dark:data-highlighted:bg-white/10";
</script>

{#snippet controls(showFullscreen: boolean)}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger class={controlBtn} title="Copy table" aria-label="Copy table">
			{#if copied}
				<CarbonCheckmark class="size-3.5" />
			{:else}
				<CarbonCopy class="size-3.5" />
			{/if}
		</DropdownMenu.Trigger>
		<DropdownMenu.Portal>
			<DropdownMenu.Content class={menuContent} align="end" sideOffset={6}>
				<DropdownMenu.Item class={menuItem} onSelect={() => copyAs("md")}
					>Markdown</DropdownMenu.Item
				>
				<DropdownMenu.Item class={menuItem} onSelect={() => copyAs("csv")}>CSV</DropdownMenu.Item>
				<DropdownMenu.Item class={menuItem} onSelect={() => copyAs("tsv")}>TSV</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Portal>
	</DropdownMenu.Root>

	<DropdownMenu.Root>
		<DropdownMenu.Trigger class={controlBtn} title="Download table" aria-label="Download table">
			<CarbonDownload class="size-3.5" />
		</DropdownMenu.Trigger>
		<DropdownMenu.Portal>
			<DropdownMenu.Content class={menuContent} align="end" sideOffset={6}>
				<DropdownMenu.Item class={menuItem} onSelect={() => downloadAs("csv")}
					>CSV</DropdownMenu.Item
				>
				<DropdownMenu.Item class={menuItem} onSelect={() => downloadAs("md")}>
					Markdown
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Portal>
	</DropdownMenu.Root>

	{#if showFullscreen}
		<button
			type="button"
			class={controlBtn}
			title="View fullscreen"
			aria-label="View fullscreen"
			onclick={() => (fullscreen = true)}
		>
			<CarbonMaximize class="size-3.5" />
		</button>
	{/if}
{/snippet}

<div
	class="not-prose md-table my-4 flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800/40"
>
	<div class="flex items-center justify-end gap-0.5">
		{@render controls(true)}
	</div>
	<div
		bind:this={inlineEl}
		class="scrollbar-custom overflow-x-auto rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
	>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html html}
	</div>
</div>

{#if fullscreen}
	<Portal>
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Table"
			tabindex="-1"
			use:focusOnMount
			class="not-prose md-table fixed inset-0 z-50 flex flex-col bg-white outline-hidden dark:bg-gray-900"
		>
			<div class="flex items-center justify-end gap-0.5 p-3">
				{@render controls(false)}
				<button
					type="button"
					class={controlBtn}
					title="Exit fullscreen"
					aria-label="Exit fullscreen"
					onclick={() => (fullscreen = false)}
				>
					<CarbonClose class="size-5" />
				</button>
			</div>
			<div
				bind:this={fullscreenEl}
				class="scrollbar-custom flex-1 overflow-auto px-3 pb-3 [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10"
			>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html html}
			</div>
		</div>
	</Portal>
{/if}
