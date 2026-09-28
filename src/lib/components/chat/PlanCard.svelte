<script lang="ts">
	import type { MessagePlanUpdate } from "$lib/types/MessageUpdate";
	import type { PlanStepStatus } from "$lib/types/Plan";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import CarbonCheckmark from "~icons/carbon/checkmark";
	import CarbonInProgress from "~icons/carbon/in-progress";
	import CarbonRadioButton from "~icons/carbon/radio-button";
	import CarbonSubtract from "~icons/carbon/subtract";

	interface Props {
		update: MessagePlanUpdate;
	}

	let { update }: Props = $props();

	let isOpen = $state(true);

	let completedCount = $derived(update.steps.filter((s) => s.status === "completed").length);

	const stepTextClasses: Record<PlanStepStatus, string> = {
		pending: "text-gray-600 dark:text-gray-300",
		in_progress: "font-medium text-gray-700 dark:text-gray-200",
		completed: "text-gray-400 dark:text-gray-500",
		skipped: "text-gray-400 line-through dark:text-gray-500",
	};
</script>

<div class="flex max-w-full min-w-0 flex-col items-start">
	<!-- Header row -->
	<button
		type="button"
		class="group/header flex max-w-full cursor-pointer items-center gap-1.5 text-left whitespace-nowrap select-none focus:outline-hidden"
		onclick={() => (isOpen = !isOpen)}
		aria-expanded={isOpen}
		aria-label={isOpen ? "Collapse plan" : "Expand plan"}
	>
		<span
			class="shrink-0 text-sm font-medium transition-colors group-hover/header:text-gray-600 dark:group-hover/header:text-gray-300 {isOpen
				? 'text-gray-600 dark:text-gray-300'
				: 'text-gray-500 dark:text-gray-400'}"
		>
			Plan
		</span>
		<span
			class="shrink-0 rounded-sm bg-gray-100 px-1 py-px font-mono text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400"
		>
			{completedCount}/{update.steps.length}
		</span>
		{#if update.explanation}
			<span class="min-w-0 truncate text-xs text-gray-400 dark:text-gray-500">
				{update.explanation}
			</span>
		{/if}
		<CarbonChevronRight
			class="size-3.5 shrink-0 transition-all duration-200 group-hover/header:text-gray-600 dark:group-hover/header:text-gray-300 {isOpen
				? 'rotate-90 text-gray-600 dark:text-gray-300'
				: 'text-gray-400'}"
		/>
	</button>

	<!-- Expandable content -->
	{#if isOpen}
		<div class="mt-1.5 w-full min-w-0">
			<p class="text-xs break-words text-gray-500 dark:text-gray-400">{update.goal}</p>
			<ol class="mt-1.5 flex w-full list-none flex-col gap-1">
				{#each update.steps as step, i (i)}
					<li
						data-status={step.status}
						class="flex min-w-0 items-start gap-1.5 text-sm {stepTextClasses[step.status]}"
					>
						<span class="mt-1 shrink-0" aria-hidden="true">
							{#if step.status === "completed"}
								<CarbonCheckmark class="size-3.5 text-green-600 dark:text-green-500" />
							{:else if step.status === "in_progress"}
								<CarbonInProgress class="size-3.5 text-orange-600 dark:text-orange-400" />
							{:else if step.status === "skipped"}
								<CarbonSubtract class="size-3.5 text-gray-300 dark:text-gray-600" />
							{:else}
								<CarbonRadioButton class="size-3.5 text-gray-300 dark:text-gray-600" />
							{/if}
						</span>
						<span class="min-w-0 break-words">{step.step}</span>
					</li>
				{/each}
			</ol>
		</div>
	{/if}
</div>
