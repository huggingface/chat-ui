<script lang="ts">
	import LucideX from "~icons/lucide/x";
	import { ML_ASSISTANT_PROMO_NOTE } from "$lib/constants/mlAssistant";

	interface Props {
		/** Collapses the banner out of the composer when false, rather than unmounting it. */
		visible: boolean;
		/** Starts a fresh ML Intern chat seeded with this conversation's question. */
		onask: () => void;
		ondismiss: () => void;
	}

	let { visible, onask, ondismiss }: Props = $props();
</script>

<!-- Shown where the mode strip would sit, on conversations that started without
     the mode: the toggle is locked out of them, so this offers the next best
     thing instead of silently dropping the affordance. -->
<div class="ml-promo-collapse" class:is-open={visible} inert={!visible}>
	<div
		class="flex items-center gap-[9px] border-b border-[#ececee] px-4 py-[9px] text-[13.5px] text-[#9a9aa0] dark:border-gray-700 dark:text-gray-500"
	>
		<button
			type="button"
			class="flex-none cursor-pointer font-medium text-[#c2410c] hover:underline dark:text-[#fdba74]"
			onclick={onask}
		>
			Ask in ML Intern
		</button>
		<span class="truncate text-[#c2c2c8] dark:text-gray-600">{ML_ASSISTANT_PROMO_NOTE}</span>
		<button
			type="button"
			class="-my-1 -mr-2 ml-auto flex size-8 flex-none cursor-pointer items-center justify-center rounded-md text-[#c2c2c8] hover:bg-black/5 hover:text-[#9a9aa0] dark:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-400"
			onclick={ondismiss}
			aria-label="Dismiss"
		>
			<LucideX class="size-3.5" />
		</button>
	</div>
</div>

<style>
	/* Same collapse treatment as the mode strip, so the two trade places in the
	   composer without a layout jump (see MlAssistantStrip.svelte). */
	.ml-promo-collapse {
		max-height: 0;
		opacity: 0;
		overflow: hidden;
		border-top-left-radius: calc(0.75rem - 1px);
		border-top-right-radius: calc(0.75rem - 1px);
		transition:
			max-height 0.45s cubic-bezier(0.4, 0, 0.2, 1),
			opacity 0.3s ease;
	}

	.ml-promo-collapse.is-open {
		max-height: 56px;
		opacity: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.ml-promo-collapse {
			transition: none;
		}
	}
</style>
