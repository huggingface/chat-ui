<script lang="ts">
	import type { RecordDecision } from "$lib/utils/review/progress";

	import CarbonCheckmark from "~icons/carbon/checkmark";
	import CarbonClose from "~icons/carbon/close";

	interface Props {
		decision: RecordDecision | undefined;
		disabled?: boolean;
		labels?: [string, string];
		/** a press on the decision already made takes it back */
		ondecide: (decision: RecordDecision | undefined) => void;
	}

	let { decision, disabled = false, labels = ["Approve", "Reject"], ondecide }: Props = $props();

	const press = (e: MouseEvent, value: RecordDecision) => {
		e.stopPropagation();
		ondecide(decision === value ? undefined : value);
	};
</script>

<span class="flex flex-none gap-1" data-decision-toggle>
	<button
		type="button"
		class={[
			"inline-flex h-7 w-[34px] items-center justify-center rounded-[7px] border",
			decision === "approved"
				? "border-transparent bg-green-50 text-green-700 dark:bg-green-400/10 dark:text-green-400"
				: "border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400",
		]}
		aria-label={labels[0]}
		aria-pressed={decision === "approved"}
		{disabled}
		onclick={(e) => press(e, "approved")}
	>
		<CarbonCheckmark />
	</button>
	<button
		type="button"
		class={[
			"inline-flex h-7 w-[34px] items-center justify-center rounded-[7px] border",
			decision === "rejected"
				? "border-transparent bg-red-50 text-red-600 dark:bg-red-400/10 dark:text-red-400"
				: "border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400",
		]}
		aria-label={labels[1]}
		aria-pressed={decision === "rejected"}
		{disabled}
		onclick={(e) => press(e, "rejected")}
	>
		<CarbonClose />
	</button>
</span>
