<script lang="ts">
	import { flushSync, tick } from "svelte";
	import CarbonArrowLeft from "~icons/carbon/arrow-left";
	import CarbonChevronDown from "~icons/carbon/chevron-down";
	import CarbonChevronUp from "~icons/carbon/chevron-up";
	import { MAX_OTHER_CHARS } from "$lib/types/McpElicitation";
	import type {
		ElicitationField,
		ElicitationRequestPayload,
		ElicitationValue,
	} from "$lib/types/McpElicitation";
	import { sendElicitationAnswer } from "$lib/utils/sendElicitationAnswer";
	import { unregisterQuestion } from "$lib/stores/pendingQuestion";
	import { ML_ASSISTANT_MODE } from "$lib/utils/mlAssistantFlag";
	import { mlAssistant } from "$lib/stores/mlAssistant.svelte";
	import { usdToMicroUsd } from "$lib/utils/mlBudget";

	interface Props {
		conversationId: string;
		request: ElicitationRequestPayload;
	}

	let { conversationId, request }: Props = $props();

	const fields = $derived(request.fields ?? []);

	let step = $state(0);
	let picks = $state<Record<string, string[]>>({});
	let otherText = $state<Record<string, string>>({});
	let showOther = $state<Record<string, boolean>>({});
	let submitting = $state(false);
	let error = $state<string | null>(null);

	const bodyId = $props.id();
	// By question, so a newer one arriving in this same panel opens expanded.
	let collapsedId = $state<string | null>(null);
	let collapsed = $derived(collapsedId === request.elicitationId);
	let collapseButton = $state<HTMLButtonElement>();
	let expandButton = $state<HTMLButtonElement>();

	async function setCollapsed(next: boolean) {
		collapsedId = next ? request.elicitationId : null;
		await tick();
		(next ? expandButton : collapseButton)?.focus();
	}

	// The on-screen keyboard shrinks only the visual viewport, never dvh: sized from dvh
	// alone, the panel and its typed-answer box end up behind the keyboard.
	let visibleHeight = $state<number>();
	$effect(() => {
		const viewport = window.visualViewport;
		if (!viewport) return;
		const measure = () => (visibleHeight = viewport.height);
		measure();
		viewport.addEventListener("resize", measure);
		return () => viewport.removeEventListener("resize", measure);
	});

	let field = $derived<ElicitationField | undefined>(fields[step]);
	/** Every question normalizes to a select; anything else is not one of ours to draw. */
	let select = $derived(field?.kind === "select" ? field : undefined);
	let isLast = $derived(step === fields.length - 1);
	/** Only for questions a click cannot finish: several answers, or one being typed. */
	let needsNext = $derived(
		!isLast && select !== undefined && (select.multiple || showOther[select.name] === true)
	);
	const chosen = (name: string) => picks[name] ?? [];

	function toggle(f: ElicitationField, value: string) {
		const multiple = f.kind === "select" && f.multiple;
		const current = chosen(f.name);
		const next = multiple
			? current.includes(value)
				? current.filter((v) => v !== value)
				: [...current, value]
			: [value];
		picks = { ...picks, [f.name]: next };
		// Or a typed answer would still show as chosen beside the picked one.
		if (!multiple) showOther = { ...showOther, [f.name]: false };
		error = null;
		// Never off the last question: sending is the user's own act.
		if (!multiple && !isLast) step += 1;
	}

	let otherInput = $state<HTMLInputElement>();

	function toggleOther(f: ElicitationField) {
		const multiple = f.kind === "select" && f.multiple;
		const next = !showOther[f.name];
		// Flushed so the box exists to focus while still inside the tap: iOS raises the
		// keyboard only for a focus the user's own gesture made.
		flushSync(() => {
			showOther = { ...showOther, [f.name]: next };
			if (next && !multiple) picks = { ...picks, [f.name]: [] };
			error = null;
		});
		if (!next) return;
		// It opens at the foot of the options, which can be below the panel's fold.
		otherInput?.focus({ preventScroll: true });
		otherInput?.scrollIntoView({ block: "nearest" });
	}

	const answerFor = (f: ElicitationField): string[] => {
		const typed = showOther[f.name] ? (otherText[f.name] ?? "").trim() : "";
		return typed ? [...chosen(f.name), typed] : chosen(f.name);
	};

	const answered = $derived(field ? answerFor(field).length > 0 : false);

	function advance() {
		if (!field) return;
		if (!answered) {
			error = showOther[field.name]
				? "Type your answer, or pick one of the options."
				: "Pick an option to continue.";
			return;
		}
		error = null;
		if (!isLast) step += 1;
	}

	async function finish(action: "accept" | "decline") {
		if (submitting) return;
		if (action === "accept" && !answered) return advance();
		submitting = true;
		error = null;

		const content: Record<string, ElicitationValue> = {};
		if (action === "accept") {
			for (const f of fields) {
				const answer = answerFor(f);
				if (answer.length === 0) continue;
				content[f.name] = f.kind === "select" && f.multiple ? answer : answer[0];
			}
		}

		const result = await sendElicitationAnswer({
			conversationId,
			elicitationId: request.elicitationId,
			action,
			...(action === "accept" ? { content } : {}),
		});
		submitting = false;
		if (!result.ok) {
			// The answer that stands is the earlier one, so there is nothing left to ask; the
			// transcript row settles when the continuation reports it.
			if (result.answered) unregisterQuestion(request.elicitationId);
			else error = result.error;
			return;
		}
		// Mirror a budget grant into the strip right away — the server applied it
		// as part of accepting this answer, and the next stream update is a whole
		// tool round away. Same rule as the server: chosen options only.
		if (action === "accept" && ML_ASSISTANT_MODE && mlAssistant.budget) {
			let grantedUsd: number | undefined;
			for (const f of fields) {
				if (f.kind !== "select") continue;
				const value = content[f.name];
				const values = Array.isArray(value) ? value : [value];
				for (const option of f.options) {
					if (option.setBudgetUsd !== undefined && values.includes(option.value)) {
						grantedUsd = Math.max(grantedUsd ?? 0, option.setBudgetUsd);
					}
				}
			}
			if (grantedUsd !== undefined) {
				mlAssistant.setBudget({
					...mlAssistant.budget,
					totalMicroUsd: usdToMicroUsd(grantedUsd),
				});
			}
		}
		// Only this question: another may still be open behind it.
		unregisterQuestion(request.elicitationId);
	}

	const rowClass =
		"flex w-full cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 text-left transition-colors " +
		"hover:bg-gray-100 dark:hover:bg-gray-700/60 " +
		"focus:ring-2 focus:ring-gray-300 focus:outline-hidden dark:focus:ring-gray-700";
</script>

<!-- Sized against the visible viewport: this sits in the composer overlay, outside the chat's
     scroller, and the page itself never scrolls — uncapped, a long question pushed its own
     top off-screen with nothing left to scroll it back. -->
<div
	class="mb-2 flex max-h-[calc(var(--ask-visible-height,100dvh)*0.6)] w-full max-w-4xl flex-col rounded-xl border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
	style:--ask-visible-height={visibleHeight ? `${visibleHeight}px` : undefined}
	role="group"
	aria-label="Question from the assistant"
>
	{#if select}
		{#if collapsed}
			<button
				bind:this={expandButton}
				type="button"
				class="flex w-full items-center gap-2 rounded-xl px-4 py-2.5 text-left outline-hidden hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-300 dark:hover:bg-gray-700/60 dark:focus-visible:ring-gray-700"
				aria-expanded="false"
				aria-controls={bodyId}
				onclick={() => setCollapsed(false)}
			>
				<span class="size-2 shrink-0 rounded-full bg-blue-500 dark:bg-blue-400"></span>
				<span class="shrink-0 text-sm font-medium text-gray-900 dark:text-gray-100">
					Question waiting
				</span>
				{#if select.title && select.title !== select.description}
					<span class="min-w-0 truncate text-sm text-gray-500 dark:text-gray-400">
						{select.title}
					</span>
				{/if}
				<CarbonChevronUp class="ml-auto size-4 shrink-0 text-gray-500 dark:text-gray-400" />
			</button>
		{/if}

		<div id={bodyId} class="flex min-h-0 flex-col p-4" hidden={collapsed}>
			<div class="mb-3 flex shrink-0 items-start gap-3">
				<p
					class="scrollbar-custom max-h-[calc(var(--ask-visible-height,100dvh)*0.25)] min-w-0 flex-1 overflow-y-auto overscroll-contain text-sm font-medium break-words text-gray-900 dark:text-gray-100"
				>
					{select.description ?? select.title ?? ""}
				</p>
				{#if fields.length > 1}
					<span class="shrink-0 pt-px text-xs text-gray-500 dark:text-gray-400">
						{step + 1} of {fields.length}
					</span>
				{/if}
				<button
					bind:this={collapseButton}
					type="button"
					class="-mt-1 -mr-2 shrink-0 rounded-lg p-1 text-gray-500 outline-hidden hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-gray-300 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus-visible:ring-gray-700"
					aria-label="Collapse question"
					title="Collapse question"
					aria-expanded="true"
					aria-controls={bodyId}
					onclick={() => setCollapsed(true)}
				>
					<CarbonChevronDown class="size-4" />
				</button>
			</div>

			<div
				class="scrollbar-custom flex min-h-0 flex-col gap-1.5 overflow-y-auto overscroll-contain border-y border-gray-200 py-2 dark:border-gray-700"
				data-testid="ask-options"
			>
				{#each select.options as option (option.value)}
					{@const picked = chosen(select.name).includes(option.value)}
					<button
						type="button"
						class={rowClass}
						aria-pressed={picked}
						disabled={submitting}
						onclick={() => toggle(select, option.value)}
					>
						<span
							class="mt-0.5 flex size-4 shrink-0 items-center justify-center border-2 {select.multiple
								? 'rounded'
								: 'rounded-full'} {picked
								? 'border-blue-500 bg-blue-500 dark:border-blue-400 dark:bg-blue-400'
								: 'border-gray-400 dark:border-gray-500'}"
						>
							{#if picked}
								<span class="block size-1.5 rounded-full bg-white"></span>
							{/if}
						</span>
						<span class="min-w-0">
							<span
								class="block text-sm {picked
									? 'font-medium text-blue-700 dark:text-blue-300'
									: 'text-gray-900 dark:text-gray-100'}">{option.label}</span
							>
							{#if option.description}
								<span class="block text-xs text-gray-500 dark:text-gray-400"
									>{option.description}</span
								>
							{/if}
							{#if option.setBudgetUsd !== undefined}
								<!-- From the option's own metadata, never its label: what this
							     shows is exactly what the server applies if it is picked. -->
								<span class="block text-xs font-medium text-amber-700 dark:text-amber-400">
									Sets compute budget to ${option.setBudgetUsd.toFixed(2)}
								</span>
							{/if}
						</span>
					</button>
				{/each}

				{#if select.allowOther}
					{@const on = showOther[select.name] === true}
					<button
						type="button"
						class={rowClass}
						aria-pressed={on}
						disabled={submitting}
						onclick={() => toggleOther(select)}
					>
						<span
							class="mt-0.5 flex size-4 shrink-0 items-center justify-center border-2 {select.multiple
								? 'rounded'
								: 'rounded-full'} {on
								? 'border-blue-500 bg-blue-500 dark:border-blue-400 dark:bg-blue-400'
								: 'border-gray-400 dark:border-gray-500'}"
						>
							{#if on}
								<span class="block size-1.5 rounded-full bg-white"></span>
							{/if}
						</span>
						<span
							class="text-sm {on
								? 'font-medium text-blue-700 dark:text-blue-300'
								: 'text-gray-900 dark:text-gray-100'}">Something else…</span
						>
					</button>
					{#if on}
						<input
							bind:this={otherInput}
							type="text"
							value={otherText[select.name] ?? ""}
							oninput={(event) =>
								(otherText = { ...otherText, [select.name]: event.currentTarget.value })}
							onkeydown={(event) => {
								if (event.key === "Enter" && !event.isComposing) {
									event.preventDefault();
									if (isLast) {
										void finish("accept");
									} else {
										advance();
									}
								}
							}}
							maxlength={MAX_OTHER_CHARS}
							disabled={submitting}
							placeholder="Tell us what you had in mind"
							aria-label="Your own answer"
							class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-gray-300 focus:outline-hidden dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:ring-gray-700"
						/>
					{/if}
				{/if}
			</div>

			<div class="shrink-0">
				{#if error}
					<p class="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
				{/if}

				<div class="mt-2 flex min-h-7 items-center gap-2">
					{#if step > 0}
						<button
							type="button"
							class="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
							disabled={submitting}
							onclick={() => {
								step -= 1;
								error = null;
							}}
						>
							<CarbonArrowLeft class="size-3" /> Back
						</button>
					{/if}
					{#if isLast}
						<button
							type="button"
							class="rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
							disabled={submitting}
							onclick={() => finish("accept")}
						>
							Send
						</button>
					{:else if needsNext}
						<button
							type="button"
							class="rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
							disabled={submitting}
							onclick={() => advance()}
						>
							Next
						</button>
					{/if}
					<button
						type="button"
						class="ml-auto rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
						disabled={submitting}
						onclick={() => finish("decline")}
					>
						Skip
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
