<script lang="ts">
	import CarbonArrowLeft from "~icons/carbon/arrow-left";
	import { MAX_OTHER_CHARS } from "$lib/types/McpElicitation";
	import type {
		ElicitationField,
		ElicitationRequestPayload,
		ElicitationValue,
	} from "$lib/types/McpElicitation";
	import { sendElicitationAnswer } from "$lib/utils/sendElicitationAnswer";
	import { unregisterQuestion } from "$lib/stores/pendingQuestion";

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

	function toggleOther(f: ElicitationField) {
		const multiple = f.kind === "select" && f.multiple;
		const next = !showOther[f.name];
		showOther = { ...showOther, [f.name]: next };
		if (next && !multiple) picks = { ...picks, [f.name]: [] };
		error = null;
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
			error = result.error;
			return;
		}
		// Only this question: another may still be open behind it.
		unregisterQuestion(request.elicitationId);
	}

	const rowClass =
		"flex w-full cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 text-left transition-colors " +
		"hover:bg-gray-100 dark:hover:bg-gray-700/60 " +
		"focus:ring-2 focus:ring-gray-300 focus:outline-hidden dark:focus:ring-gray-700";
</script>

<div
	class="mb-2 w-full max-w-4xl rounded-xl border border-gray-300 bg-white p-4 shadow-lg dark:border-gray-600 dark:bg-gray-800"
	role="group"
	aria-label="Question from the assistant"
>
	{#if select}
		<div class="mb-3 flex items-baseline justify-between gap-3">
			<p class="text-sm font-medium text-gray-900 dark:text-gray-100">
				{select.description ?? select.title ?? ""}
			</p>
			{#if fields.length > 1}
				<span class="shrink-0 text-xs text-gray-500 dark:text-gray-400">
					{step + 1} of {fields.length}
				</span>
			{/if}
		</div>

		<div class="flex flex-col gap-1.5 border-y border-gray-200 py-2 dark:border-gray-700">
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
						type="text"
						value={otherText[select.name] ?? ""}
						oninput={(event) =>
							(otherText = { ...otherText, [select.name]: event.currentTarget.value })}
						maxlength={MAX_OTHER_CHARS}
						disabled={submitting}
						placeholder="Tell us what you had in mind"
						aria-label="Your own answer"
						class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-gray-300 focus:outline-hidden dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:ring-gray-700"
					/>
				{/if}
			{/if}
		</div>

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
	{/if}
</div>
