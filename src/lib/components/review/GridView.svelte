<script lang="ts">
	import { tick } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
	import type { ReviewSession } from "$lib/stores/mlReview.svelte";
	import {
		canDecide,
		leadImageField,
		plainText,
		recordDecision,
		shownFields,
		type RecordDecision,
	} from "$lib/utils/review/progress";
	import { imageUrl } from "$lib/utils/review/view";

	import CarbonCheckmark from "~icons/carbon/checkmark";
	import CarbonChat from "~icons/carbon/chat";
	import CarbonClose from "~icons/carbon/close";
	import CarbonGrid from "~icons/carbon/grid";
	import CarbonMaximize from "~icons/carbon/maximize";
	import CarbonSquareOutline from "~icons/carbon/square-outline";

	interface Props {
		session: ReviewSession;
		onopen: (index: number) => void;
		/** true while images are selected, the selection bar then stands in for the review footer */
		selecting?: boolean;
	}

	let { session, onopen, selecting = $bindable(false) }: Props = $props();

	type Filter = "all" | "todo" | "approved" | "rejected" | "commented";

	let schema = $derived(session.schema);
	let records = $derived(session.records);
	let editable = $derived(session.editable);
	let decidable = $derived(!!schema && canDecide(schema));
	let image = $derived(schema ? leadImageField(schema) : undefined);
	let caption = $derived(
		schema
			? shownFields(schema).find(
					(field) => field !== image && (field.type === "category" || field.type === "text")
				)
			: undefined
	);

	const selected = new SvelteSet<number>();
	let bulkError = $state<string | undefined>(undefined);
	let anchor = $state<number | undefined>(undefined);
	let filter = $state<Filter>("all");
	let small = $state(false);
	let composing = $state(false);
	let text = $state("");
	let textEl: HTMLTextAreaElement | undefined = $state();

	const commentCount = (index: number) => session.draft(index)?.comments.length ?? 0;
	const decisionOf = (index: number): RecordDecision | undefined =>
		schema ? recordDecision(schema, session.draft(index)) : undefined;

	let decisions = $derived(records.map((_, index) => decisionOf(index)));
	let tally = $derived({
		all: records.length,
		todo: decisions.filter((decision) => decision === undefined).length,
		approved: decisions.filter((decision) => decision === "approved").length,
		rejected: decisions.filter((decision) => decision === "rejected").length,
		commented: records.filter((_, index) => commentCount(index) > 0).length,
	});
	let filters = $derived<[Filter, string][]>(
		decidable
			? [
					["all", "All"],
					["todo", "To review"],
					["approved", "OK"],
					["rejected", "Rejected"],
					["commented", "Commented"],
				]
			: [
					["all", "All"],
					["commented", "Commented"],
				]
	);
	let shown = $derived(
		records
			.map((record, index) => ({ record, index }))
			.filter(({ index }) => {
				if (filter === "all") return true;
				if (filter === "commented") return commentCount(index) > 0;
				if (filter === "todo") return decisions[index] === undefined;
				return decisions[index] === filter;
			})
	);

	$effect(() => {
		selecting = selected.size > 0;
	});

	function clear() {
		selected.clear();
		composing = false;
		bulkError = undefined;
	}

	/** click picks one, cmd or ctrl click adds or drops, shift click adds the run from the last pick */
	function pick(index: number, e: MouseEvent | KeyboardEvent) {
		if (!editable) return onopen(index);
		if (e.shiftKey && anchor !== undefined) {
			const order = shown.map((entry) => entry.index);
			const from = order.indexOf(anchor);
			const to = order.indexOf(index);
			if (from !== -1 && to !== -1) {
				for (const at of order.slice(Math.min(from, to), Math.max(from, to) + 1)) {
					selected.add(at);
				}
				return;
			}
		}
		anchor = index;
		if (e.metaKey || e.ctrlKey || e instanceof KeyboardEvent) {
			if (selected.has(index)) selected.delete(index);
			else selected.add(index);
		} else if (selected.size === 1 && selected.has(index)) {
			selected.clear();
		} else {
			selected.clear();
			selected.add(index);
		}
		if (selected.size === 0) composing = false;
	}

	function selectAll() {
		for (const { index } of shown) selected.add(index);
	}

	/** a selection saves in one request, a refusal keeps the selection so it can be tried again */
	async function decide(decision: RecordDecision) {
		bulkError = await session.bulk(selected, { decision });
		if (!bulkError) clear();
	}

	async function compose() {
		composing = true;
		await tick();
		textEl?.focus();
	}

	/** one comment per selected record, the server keeps comments per record */
	async function commentOnSelected() {
		const body = text.trim();
		if (!body) return;
		bulkError = await session.bulk(selected, { comment: { body, field: image?.name } });
		if (bulkError) return;
		text = "";
		clear();
	}

	let room = $derived(selected.size > 0 ? session.commentRoom(selected) : undefined);

	const isTyping = (target: EventTarget | null) =>
		target instanceof HTMLElement &&
		(target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

	$effect(() => {
		if (!editable) return;
		const onkey = (e: KeyboardEvent) => {
			if (isTyping(e.target)) return;
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
				e.preventDefault();
				selectAll();
			} else if (e.key === "Escape" && selected.size > 0) {
				e.preventDefault();
				e.stopPropagation();
				clear();
			}
		};
		window.addEventListener("keydown", onkey, true);
		return () => window.removeEventListener("keydown", onkey, true);
	});

	const many = (n: number) => (n === 1 ? "it" : n === 2 ? "both" : `all ${n}`);
</script>

<div
	class="flex flex-none items-center gap-2 border-b border-gray-200 py-2.5 pr-3 pl-4 dark:border-gray-800"
>
	<div class="flex min-w-0 flex-1 flex-wrap gap-1.5" role="group" aria-label="Filter">
		{#each filters as [key, label] (key)}
			<button
				type="button"
				class={[
					"inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-medium",
					filter === key
						? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
						: "border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-300",
				]}
				aria-pressed={filter === key}
				data-filter={key}
				onclick={() => (filter = key)}
			>
				{label}
				<span class={filter === key ? "opacity-70" : "text-gray-500 dark:text-gray-400"}
					>{tally[key]}</span
				>
			</button>
		{/each}
	</div>
	{#if editable}
		<button
			type="button"
			class="h-7 flex-none rounded-lg px-2 text-[12.5px] font-medium whitespace-nowrap text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
			onclick={() => (selected.size > 0 ? clear() : selectAll())}
		>
			{selected.size > 0 ? "Deselect all" : "Select all"}
		</button>
	{/if}
	<div
		class="flex flex-none rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800"
		role="group"
		aria-label="Tile size"
	>
		<button
			type="button"
			class={[
				"h-[26px] rounded-md px-2.5 text-xs",
				small
					? "bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100"
					: "text-gray-500",
			]}
			aria-label="Small tiles"
			aria-pressed={small}
			onclick={() => (small = true)}
		>
			<CarbonGrid />
		</button>
		<button
			type="button"
			class={[
				"h-[26px] rounded-md px-2.5 text-xs",
				!small
					? "bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100"
					: "text-gray-500",
			]}
			aria-label="Large tiles"
			aria-pressed={!small}
			onclick={() => (small = false)}
		>
			<CarbonSquareOutline />
		</button>
	</div>
</div>

<div class="scrollbar-custom min-h-0 flex-1 overflow-y-auto p-4" data-grid-view>
	{#if editable && selected.size === 0}
		<p class="m-0 mb-3 text-xs text-gray-500 dark:text-gray-400">
			Click to select, <kbd class="font-mono">⌘</kbd>/<kbd class="font-mono">Ctrl</kbd> click to
			add,
			<kbd class="font-mono">Shift</kbd> click for a range, double-click or
			<kbd class="font-mono">↵</kbd> to open.
		</p>
	{/if}
	<div class={["grid gap-x-3.5 gap-y-[18px]", small ? "grid-cols-6" : "grid-cols-4"]}>
		{#each shown as { record, index } (index)}
			{@const src =
				image && typeof record.values[image.name] === "string"
					? imageUrl(record.values[image.name] as string)
					: undefined}
			{@const on = selected.has(index)}
			{@const notes = commentCount(index)}
			{@const decision = decisions[index]}
			<div class="group relative">
				<button
					type="button"
					class="flex w-full flex-col gap-1.5 border-0 bg-transparent p-0 text-left select-none"
					aria-label="Image {index + 1}{caption
						? `, ${plainText(record.values[caption.name])}`
						: ''}{decision ? `, ${decision === 'approved' ? 'OK' : 'rejected'}` : ''}"
					aria-pressed={editable ? on : undefined}
					data-tile={index}
					data-decision={decision}
					onclick={(e) => pick(index, e)}
					ondblclick={() => onopen(index)}
					onkeydown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							onopen(index);
						} else if (e.key === " " && editable) {
							e.preventDefault();
							pick(index, e);
						}
					}}
				>
					<span
						class={[
							"relative block aspect-square overflow-hidden rounded-[10px] bg-gray-100 dark:bg-gray-800",
							on &&
								"shadow-[0_0_0_2px_white,0_0_0_4px_#2563eb] dark:shadow-[0_0_0_2px_#111,0_0_0_4px_#60a5fa]",
						]}
					>
						{#if src}
							<img
								{src}
								alt=""
								loading="lazy"
								draggable="false"
								class={["block size-full object-cover", decision === "rejected" && "opacity-40"]}
							/>
						{/if}
						{#if on}
							<span
								class="absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-full bg-blue-600 text-white dark:bg-blue-400"
							>
								<CarbonCheckmark class="text-xs" />
							</span>
						{/if}
						{#if notes > 0}
							<span
								class="absolute top-1.5 right-1.5 flex h-5 items-center gap-[3px] rounded-full bg-amber-200 px-1.5 text-[11px] font-bold text-gray-900"
							>
								<CarbonChat class="text-[10px]" />{notes}
							</span>
						{/if}
						{#if decision}
							<span
								class={[
									"absolute bottom-1.5 left-1.5 flex h-5 items-center gap-1 rounded-full px-1.5 text-[11px] font-semibold text-white",
									decision === "approved"
										? "bg-green-600 dark:bg-green-500"
										: "bg-red-700 dark:bg-red-500",
								]}
							>
								{#if decision === "approved"}<CarbonCheckmark class="text-[11px]" />OK
								{:else}<CarbonClose class="text-[11px]" />Rejected{/if}
							</span>
						{/if}
					</span>
					<span class="truncate text-[12.5px] text-gray-500 dark:text-gray-400">
						{#if caption}<b class="font-medium text-gray-900 dark:text-gray-100"
								>{plainText(record.values[caption.name])}</b
							> ·
						{/if}#{index + 1}
					</span>
				</button>
				<span class="pointer-events-none absolute inset-x-0 top-0 aspect-square">
					<button
						type="button"
						class="pointer-events-auto absolute right-1.5 bottom-1.5 flex size-7 items-center justify-center rounded-lg bg-gray-900/75 text-white opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-gray-900 focus-visible:opacity-100"
						aria-label="Open image {index + 1}"
						data-open-tile={index}
						onclick={() => onopen(index)}
					>
						<CarbonMaximize class="text-sm" />
					</button>
				</span>
			</div>
		{/each}
	</div>
</div>

{#if selected.size > 0 && editable}
	<div
		class="mx-4 mb-3 flex flex-none flex-col gap-2 rounded-xl bg-gray-900 py-2 pr-2 pl-3.5 text-white shadow-[0_6px_20px_rgba(0,0,0,0.18)] dark:bg-gray-100 dark:text-gray-900"
		data-selection-bar
	>
		{#if bulkError || (composing && room)}
			<p
				class="m-0 mt-1 mr-1.5 text-[13px] text-red-300 dark:text-red-700"
				role="alert"
				data-bulk-error
			>
				{bulkError ?? room}
			</p>
		{/if}
		{#if composing}
			<textarea
				bind:this={textEl}
				bind:value={text}
				rows="2"
				maxlength={2000}
				aria-label="Comment on the selected images"
				placeholder="One comment, added to each selected image"
				class="mt-1 mr-1.5 resize-y rounded-lg border-0 bg-white/10 px-2.5 py-2 text-[13px] text-white outline-none placeholder:text-white/50 dark:bg-black/5 dark:text-gray-900 dark:placeholder:text-gray-500"
				onkeydown={(e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						composing = false;
					} else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						commentOnSelected();
					}
				}}
			></textarea>
		{/if}
		<div class="flex flex-wrap items-center gap-1.5">
			<span class="flex-1 text-[13px] font-medium whitespace-nowrap">{selected.size} selected</span>
			{#if composing}
				<button
					type="button"
					class="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-semibold text-gray-900 disabled:opacity-50 dark:bg-gray-900 dark:text-gray-100"
					disabled={!text.trim() || !!room || session.saving > 0}
					onclick={commentOnSelected}
				>
					Add to {selected.size === 1 ? "image" : many(selected.size)}
				</button>
			{:else}
				{#if decidable}
					<button
						type="button"
						class="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-semibold text-gray-900 dark:bg-gray-900 dark:text-gray-100"
						onclick={() => decide("approved")}
					>
						<CarbonCheckmark class="text-sm text-green-600 dark:text-green-500" />
						Mark {selected.size} OK
					</button>
					<button
						type="button"
						class="flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-[13px] font-semibold hover:bg-white/15 dark:bg-black/5 dark:hover:bg-black/10"
						onclick={() => decide("rejected")}
					>
						<CarbonClose class="text-sm text-red-400 dark:text-red-600" />
						Reject {selected.size}
					</button>
				{/if}
				<button
					type="button"
					class="flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-[13px] font-semibold hover:bg-white/15 dark:bg-black/5 dark:hover:bg-black/10"
					onclick={compose}
				>
					<CarbonChat class="text-sm" />
					Comment
				</button>
			{/if}
			<button
				type="button"
				class="h-8 rounded-lg px-2.5 text-[13px] font-medium opacity-75 hover:opacity-100"
				onclick={clear}
			>
				Clear <kbd class="font-mono text-[11px] opacity-60">Esc</kbd>
			</button>
		</div>
	</div>
{/if}
