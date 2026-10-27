<script lang="ts">
	import { onMount } from "svelte";
	import type { ReviewSession } from "$lib/stores/mlReview.svelte";
	import { headingField, modelDisagrees, plainText, shownFields } from "$lib/utils/review/progress";

	import CarbonCloseLarge from "~icons/carbon/close-large";
	import CarbonSearch from "~icons/carbon/search";
	import CarbonChat from "~icons/carbon/chat";
	import CarbonCheckmark from "~icons/carbon/checkmark";

	interface Props {
		session: ReviewSession;
		onclose: () => void;
	}

	let { session, onclose }: Props = $props();

	type Filter = "all" | "todo" | "skipped" | "commented" | "disagrees";

	let query = $state("");
	let filter = $state<Filter>("all");
	let input: HTMLInputElement | undefined = $state();

	let schema = $derived(session.schema);
	let records = $derived(session.records);
	let titleField = $derived(
		schema
			? (headingField(schema, records) ??
					shownFields(schema).find((f) => f.type === "text" || f.type === "markdown"))
			: undefined
	);
	let hasGuesses = $derived(records.some((record) => record.suggestions));

	let rows = $derived(
		records.map((record, index) => {
			const draft = session.draft(index);
			const title = titleField ? plainText(record.values[titleField.name]) : "";
			return {
				index,
				id: record.id,
				title: title || record.id,
				state: session.states[index],
				comments: draft?.comments.length ?? 0,
				disagrees: schema ? modelDisagrees(schema, record, draft) : false,
			};
		})
	);

	let counts = $derived({
		all: rows.length,
		todo: rows.filter((row) => row.state === "todo").length,
		skipped: rows.filter((row) => row.state === "skipped").length,
		commented: rows.filter((row) => row.comments > 0).length,
		disagrees: rows.filter((row) => row.disagrees).length,
	});

	let filters = $derived(
		(
			[
				["all", "All"],
				["todo", "To do"],
				["skipped", "Skipped"],
				["commented", "Commented"],
				["disagrees", "Model disagrees"],
			] as [Filter, string][]
		).filter(([key]) => key !== "disagrees" || hasGuesses)
	);

	let shown = $derived.by(() => {
		const words = query.trim().toLowerCase();
		const number = /^#?\d+$/.test(words) ? Number(words.replace("#", "")) : undefined;
		return rows.filter((row) => {
			if (filter === "todo" && row.state !== "todo") return false;
			if (filter === "skipped" && row.state !== "skipped") return false;
			if (filter === "commented" && row.comments === 0) return false;
			if (filter === "disagrees" && !row.disagrees) return false;
			if (!words) return true;
			if (number !== undefined) return row.index + 1 === number;
			return row.title.toLowerCase().includes(words) || row.id.toLowerCase().includes(words);
		});
	});

	onMount(() => input?.focus());

	function onkeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			onclose();
		} else if (e.key === "Enter" && shown[0]) {
			e.preventDefault();
			session.openRecord(shown[0].index);
		}
	}

	const share = (n: number) => (n / Math.max(rows.length, 1)) * 100;
</script>

<div class="absolute inset-0 z-30" data-record-navigator>
	<button
		type="button"
		class="absolute inset-0 cursor-default bg-black/30"
		aria-label="Close records"
		tabindex="-1"
		onclick={onclose}
	></button>
	<aside
		aria-label="Records"
		class="absolute top-0 bottom-0 left-0 flex w-[400px] max-w-full flex-col border-r border-gray-200 bg-white shadow-[8px_0_24px_rgba(0,0,0,0.08)] dark:border-gray-800 dark:bg-gray-900"
	>
		<div
			class="flex h-12 flex-none items-center gap-2 border-b border-gray-200 pr-2 pl-4 dark:border-gray-800"
		>
			<div class="flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Records</div>
			<span class="text-xs text-gray-500 dark:text-gray-400"
				>Jump with <kbd class="font-mono">G</kbd></span
			>
			<button
				type="button"
				class="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
				aria-label="Close records"
				onclick={onclose}
			>
				<CarbonCloseLarge />
			</button>
		</div>

		<div class="flex flex-col gap-2.5 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
			<label
				class="flex h-9 items-center gap-2 rounded-[9px] border border-gray-200 px-2.5 text-gray-500 focus-within:border-blue-400 dark:border-gray-700"
			>
				<CarbonSearch class="text-sm" />
				<input
					bind:this={input}
					bind:value={query}
					type="text"
					placeholder="Go to # or search text"
					aria-label="Go to record or search"
					class="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-gray-900 outline-none focus:ring-0 dark:text-gray-100"
					{onkeydown}
				/>
			</label>
			<div class="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
				{#each filters as [key, label] (key)}
					<button
						type="button"
						class={[
							"inline-flex h-[30px] items-center gap-1.5 rounded-full border px-2.5 text-[13px] font-medium whitespace-nowrap",
							filter === key
								? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
								: "border-gray-200 text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300",
						]}
						aria-pressed={filter === key}
						data-filter={key}
						onclick={() => (filter = key)}
					>
						{label}
						<span
							class={[
								"tabular-nums",
								filter === key ? "opacity-70" : "text-gray-500 dark:text-gray-400",
							]}
						>
							{counts[key]}
						</span>
					</button>
				{/each}
			</div>
		</div>

		<ul class="m-0 scrollbar-custom flex-1 list-none overflow-y-auto p-0">
			{#each shown as row (row.index)}
				{@const current = row.index === session.focus}
				<li>
					<button
						type="button"
						class={[
							"flex h-11 w-full items-center gap-2.5 border-b border-gray-200 px-4 text-left text-gray-700 dark:border-gray-800 dark:text-gray-300",
							current
								? "bg-blue-50 dark:bg-blue-400/[0.14]"
								: "hover:bg-gray-50 dark:hover:bg-gray-800/60",
						]}
						aria-current={current ? "true" : undefined}
						data-record-row={row.index}
						onclick={() => session.openRecord(row.index)}
					>
						<span
							class="w-[30px] flex-none text-right font-mono text-xs text-gray-500 dark:text-gray-400"
						>
							{row.index + 1}
						</span>
						<span class="flex size-4 flex-none items-center justify-center" aria-label={row.state}>
							{#if current}
								<span class="size-2.5 rounded-full bg-blue-600 dark:bg-blue-400"></span>
							{:else if row.state === "answered"}
								<CarbonCheckmark class="text-xs text-green-600 dark:text-green-500" />
							{:else if row.state === "skipped"}
								<span class="h-0.5 w-2.5 rounded-full bg-amber-500"></span>
							{:else}
								<span
									class="size-2.5 rounded-full border-[1.5px] border-gray-400 dark:border-gray-500"
								></span>
							{/if}
						</span>
						<span class="min-w-0 flex-1 truncate text-[13.5px]">{row.title}</span>
						{#if row.comments > 0}
							<span
								class="flex items-center gap-[3px] text-xs whitespace-nowrap text-amber-700 dark:text-amber-400"
							>
								<CarbonChat class="text-xs" />{row.comments}
							</span>
						{/if}
					</button>
				</li>
			{:else}
				<li class="px-4 py-6 text-[13px] text-gray-500 dark:text-gray-400">Nothing matches.</li>
			{/each}
		</ul>

		<div
			class="flex flex-none flex-col gap-1.5 border-t border-gray-200 px-4 py-2.5 dark:border-gray-800"
		>
			<div class="flex h-2 gap-px overflow-hidden rounded-sm">
				<div
					class="bg-green-600 dark:bg-green-500"
					style="width: {share(counts.all - counts.todo - counts.skipped)}%"
				></div>
				<div class="bg-amber-500" style="width: {share(counts.skipped)}%"></div>
				<div class="flex-1 bg-gray-100 dark:bg-gray-800"></div>
			</div>
			<div class="flex gap-3 text-xs text-gray-500 dark:text-gray-400">
				<span>{counts.all - counts.todo - counts.skipped} answered</span>
				<span>{counts.skipped} skipped</span>
				<span>{counts.todo} to do</span>
			</div>
		</div>
	</aside>
</div>
