<script lang="ts">
	import { tick } from "svelte";
	import type { ReviewSession } from "$lib/stores/mlReview.svelte";
	import type { ReviewQuestion } from "$lib/types/MlReview";
	import { isAnswered } from "$lib/utils/review/answers";
	import { AUTO_ADVANCE_MS, keyOptions, pick } from "$lib/utils/review/view";
	import { canDecide, recordDecision, shownFields } from "$lib/utils/review/progress";
	import DecisionToggle from "./DecisionToggle.svelte";
	import ProgressBar, { type BarState } from "./ProgressBar.svelte";
	import QuestionRow from "./QuestionRow.svelte";
	import RecordBody from "./RecordBody.svelte";

	import CarbonCloseLarge from "~icons/carbon/close-large";
	import CarbonChevronUp from "~icons/carbon/chevron-up";
	import CarbonChevronDown from "~icons/carbon/chevron-down";

	interface Props {
		session: ReviewSession;
		autoAdvance: boolean;
		onautoadvance: (on: boolean) => void;
	}

	let { session, autoAdvance, onautoadvance }: Props = $props();

	type Filter = "all" | "todo" | "wrong" | "commented";
	const EXTRA_COLUMNS = 4;

	let schema = $derived(session.schema);
	let records = $derived(session.records);
	let fields = $derived(schema ? shownFields(schema) : []);
	let lead = $derived(fields[0]);
	let extra = $derived(fields.slice(1, 1 + EXTRA_COLUMNS));
	let check = $derived(!!schema && canDecide(schema));
	let checkTitle = $derived(
		schema?.questions.find((question) => question.type === "boolean")?.title ?? "Correct?"
	);
	let selected = $state<number | undefined>(undefined);
	let filter = $state<Filter>("all");
	let tableEl: HTMLElement | undefined = $state();

	const decisionOf = (index: number) =>
		schema ? recordDecision(schema, session.draft(index)) : undefined;

	let states = $derived<BarState[]>(
		records.map((_, index) => {
			if (check) {
				const decision = decisionOf(index);
				return decision === "approved" ? "pass" : decision === "rejected" ? "fail" : "todo";
			}
			const state = session.states[index];
			return state;
		})
	);

	let counts = $derived({
		all: records.length,
		todo: states.filter((state) => state === "todo").length,
		wrong: states.filter((state) => state === "fail").length,
		commented: records.filter((_, index) => (session.draft(index)?.comments.length ?? 0) > 0)
			.length,
		pass: states.filter((state) => state === "pass" || state === "answered").length,
	});

	let commentedSet = $derived(
		new Set(
			records.flatMap((_, index) =>
				(session.draft(index)?.comments.length ?? 0) > 0 ? [index] : []
			)
		)
	);

	let shown = $derived(
		records
			.map((record, index) => ({ record, index }))
			.filter(({ index }) => {
				if (filter === "todo") return states[index] === "todo";
				if (filter === "wrong") return states[index] === "fail";
				if (filter === "commented") return commentedSet.has(index);
				return true;
			})
	);

	async function select(index: number | undefined) {
		selected = index;
		if (index === undefined) return;
		await tick();
		tableEl?.querySelector(`[data-table-row="${index}"]`)?.scrollIntoView({ block: "nearest" });
	}

	let keyable = $derived(schema?.questions.filter((question) => question.type !== "text") ?? []);
	/** the first pickable question the open row still lacks, number keys answer it */
	let activeQuestion = $derived.by(() => {
		if (selected === undefined) return undefined;
		const answers = session.draft(selected)?.answers ?? {};
		return keyable.find((question) => !isAnswered(answers[question.name])) ?? keyable[0];
	});
	let advanceTimer: ReturnType<typeof setTimeout> | undefined;

	/** a filter can drop the open row once it is answered, the next shown row is then the first */
	function step(by: number) {
		const order = shown.map((entry) => entry.index);
		const at = selected === undefined ? -1 : order.indexOf(selected);
		const next = at === -1 ? order[by > 0 ? 0 : order.length - 1] : order[at + by];
		if (next !== undefined) void select(next);
	}

	function nextUnchecked() {
		const order = shown.map((entry) => entry.index);
		const from = selected === undefined ? -1 : order.indexOf(selected);
		const next = [...order.slice(from + 1), ...order.slice(0, from + 1)].find(
			(index) => index !== selected && states[index] === "todo"
		);
		if (next !== undefined) void select(next);
	}

	/** moves on once every pickable question of the row is answered, a typed answer never does */
	function answered(index: number, question: ReviewQuestion) {
		if (!autoAdvance || question.type === "text" || keyable.length === 0) return;
		const answers = session.draft(index)?.answers ?? {};
		if (!keyable.every((candidate) => isAnswered(answers[candidate.name]))) return;
		clearTimeout(advanceTimer);
		advanceTimer = setTimeout(() => {
			if (selected === index) step(1);
		}, AUTO_ADVANCE_MS);
	}

	function answerByKey(index: number, question: ReviewQuestion, n: number) {
		const option = keyOptions(question)[n - 1];
		if (!option) return false;
		const next = pick(question, session.draft(index)?.answers[question.name], option.value);
		session.setAnswer(
			index,
			question.name,
			Array.isArray(next) && next.length === 0 ? undefined : next
		);
		answered(index, question);
		return true;
	}

	const isTyping = (target: EventTarget | null) =>
		target instanceof HTMLElement &&
		(target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

	$effect(() => {
		const onkey = (e: KeyboardEvent) => {
			if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
			const key = e.key.toLowerCase();
			if (key === "j" || e.key === "ArrowDown") {
				e.preventDefault();
				step(1);
			} else if (key === "k" || e.key === "ArrowUp") {
				e.preventDefault();
				step(-1);
			} else if (/^[1-9]$/.test(e.key) && selected !== undefined && activeQuestion) {
				if (!session.editable) return;
				if (answerByKey(selected, activeQuestion, Number(e.key))) e.preventDefault();
			} else if (e.key === "Enter" && selected !== undefined) {
				e.preventDefault();
				nextUnchecked();
			} else if (e.key === "Escape" && selected !== undefined) {
				e.preventDefault();
				e.stopPropagation();
				selected = undefined;
			}
		};
		window.addEventListener("keydown", onkey, true);
		return () => {
			window.removeEventListener("keydown", onkey, true);
			clearTimeout(advanceTimer);
		};
	});

	const cell = (value: unknown) => (value === undefined || value === null ? "—" : String(value));
	const columns = $derived(
		`44px minmax(0,1fr) ${extra.map(() => "112px").join(" ")} ${check ? "84px" : ""}`.trim()
	);

	const filters: [Filter, string][] = [
		["all", "All"],
		["todo", "Not checked"],
		["wrong", "Wrong"],
		["commented", "Commented"],
	];
</script>

<div
	class="flex flex-none items-center gap-2 border-b border-gray-200 py-2.5 pr-3 pl-4 dark:border-gray-800"
>
	<div class="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
		{#each filters.filter(([key]) => key !== "wrong" || check) as [key, label] (key)}
			<button
				type="button"
				class={[
					"inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-medium whitespace-nowrap",
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
					>{counts[key]}</span
				>
			</button>
		{/each}
	</div>
</div>

<div
	class="flex flex-none items-center gap-3.5 border-b border-gray-200 px-4 py-1 dark:border-gray-800"
>
	<ProgressBar
		{states}
		current={selected}
		commented={commentedSet}
		label="{counts.pass} {check
			? 'correct'
			: 'answered'}, {counts.wrong} wrong, {counts.todo} to check. Click to jump."
		onseek={(index) => select(index)}
	/>
	<span
		class="flex items-center gap-1.5 text-xs whitespace-nowrap text-gray-500 dark:text-gray-400"
	>
		<span class="size-2 rounded-[2px] bg-green-600 dark:bg-green-500"></span>{counts.pass}
		{check ? "correct" : "answered"}
	</span>
	{#if check}
		<span
			class="flex items-center gap-1.5 text-xs whitespace-nowrap text-gray-500 dark:text-gray-400"
		>
			<span class="size-2 rounded-[2px] bg-red-700 dark:bg-red-500"></span>{counts.wrong} wrong
		</span>
	{/if}
	<span
		class="flex items-center gap-1.5 text-xs whitespace-nowrap text-gray-500 dark:text-gray-400"
	>
		<span
			class="size-2 rounded-[2px] bg-gray-100 ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700"
		></span>{counts.todo}
		to check
	</span>
</div>

<div class="flex min-h-0 flex-1">
	<div
		bind:this={tableEl}
		class="scrollbar-custom min-w-0 flex-1 overflow-auto"
		role="table"
		aria-label="Rows"
		data-table-view
	>
		<div
			class="sticky top-0 z-[1] grid h-9 items-center gap-x-3 border-b border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-500 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-400"
			style="grid-template-columns: {columns}"
			role="row"
		>
			<span class="text-right" role="columnheader">#</span>
			<span role="columnheader">{lead?.title ?? lead?.name}</span>
			{#each extra as field (field.name)}
				<span class="truncate" role="columnheader">{field.title ?? field.name}</span>
			{/each}
			{#if check}
				<span class="text-gray-900 dark:text-gray-100" role="columnheader">{checkTitle}</span>
			{/if}
		</div>
		{#each shown as { record, index } (index)}
			<div
				class={[
					"grid h-[52px] cursor-pointer items-center gap-x-3 border-b border-gray-200 px-3 text-[13.5px] dark:border-gray-800",
					selected === index
						? "bg-blue-50 dark:bg-blue-400/[0.14]"
						: "hover:bg-gray-50 dark:hover:bg-gray-800/40",
				]}
				style="grid-template-columns: {columns}"
				role="row"
				tabindex="0"
				data-table-row={index}
				onclick={() => select(index)}
				onkeydown={(e) => e.key === "Enter" && select(index)}
			>
				<span class="text-right font-mono text-xs text-gray-500 dark:text-gray-400"
					>{index + 1}</span
				>
				<span class="line-clamp-2 leading-[1.4] text-gray-900 dark:text-gray-100">
					{lead ? cell(record.values[lead.name]) : record.id}
				</span>
				{#each extra as field (field.name)}
					<span class="relative justify-self-start">
						<span
							class={field.type === "category"
								? "rounded-[5px] bg-gray-100 px-[7px] py-[3px] text-xs font-medium whitespace-nowrap text-gray-700 dark:bg-gray-800 dark:text-gray-300"
								: field.type === "number"
									? "font-mono text-[12.5px] text-gray-700 dark:text-gray-300"
									: "line-clamp-2 text-[12.5px] text-gray-500 dark:text-gray-400"}
						>
							{cell(record.values[field.name])}
						</span>
					</span>
				{/each}
				{#if check}
					<DecisionToggle
						decision={decisionOf(index)}
						labels={["Correct", "Wrong"]}
						disabled={!session.editable}
						ondecide={(decision) => session.decide([index], decision)}
					/>
				{/if}
			</div>
		{/each}
	</div>

	{#if selected !== undefined && records[selected]}
		{@const index = selected}
		<aside
			aria-label="Row {index + 1}"
			class="flex w-[340px] flex-none flex-col border-l border-gray-200 dark:border-gray-800"
			data-row-detail
		>
			<div
				class="flex h-11 flex-none items-center gap-1 border-b border-gray-200 pr-1.5 pl-4 dark:border-gray-800"
			>
				<span class="flex-1 text-[13px] font-semibold text-gray-900 dark:text-gray-100"
					>Row {index + 1}</span
				>
				<button
					type="button"
					class="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800"
					aria-label="Previous row"
					disabled={index === 0}
					onclick={() => select(index - 1)}
				>
					<CarbonChevronUp />
				</button>
				<button
					type="button"
					class="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800"
					aria-label="Next row"
					disabled={index >= records.length - 1}
					onclick={() => select(index + 1)}
				>
					<CarbonChevronDown />
				</button>
				<button
					type="button"
					class="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
					aria-label="Close row"
					onclick={() => (selected = undefined)}
				>
					<CarbonCloseLarge />
				</button>
			</div>
			<div class="scrollbar-custom flex flex-1 flex-col gap-4 overflow-y-auto">
				<div class="px-4 pt-4">
					<RecordBody {session} {index} />
				</div>
				{#if (schema?.questions.length ?? 0) > 0}
					<div class="border-t border-gray-200 dark:border-gray-800">
						{#each schema?.questions ?? [] as question (question.name)}
							<QuestionRow
								{question}
								value={session.draft(index)?.answers[question.name]}
								suggestion={records[index]?.suggestions?.[question.name]}
								mode={schema?.suggestions ?? "none"}
								active={activeQuestion?.name === question.name}
								disabled={!session.editable}
								layout="stack"
								onchange={(answer) => {
									session.setAnswer(index, question.name, answer);
									answered(index, question);
								}}
							/>
						{/each}
					</div>
				{/if}
			</div>
			{#if session.editable}
				<div
					class="flex flex-none items-center gap-2 border-t border-gray-200 py-2 pr-3 pl-2 dark:border-gray-800"
				>
					<label
						class="flex min-h-8 cursor-pointer items-center gap-1.5 px-2 text-[13px] text-gray-500 dark:text-gray-400"
					>
						<input
							type="checkbox"
							class="m-0 accent-gray-900 dark:accent-gray-100"
							checked={autoAdvance}
							onchange={(e) => onautoadvance(e.currentTarget.checked)}
						/>
						Auto-advance
					</label>
					<span class="flex-1"></span>
					<button
						type="button"
						class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-[13px] font-semibold whitespace-nowrap text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
						onclick={nextUnchecked}
					>
						Next unchecked <kbd class="font-mono text-[11px] opacity-60">↵</kbd>
					</button>
				</div>
			{/if}
		</aside>
	{/if}
</div>
