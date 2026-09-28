<script lang="ts">
	import { fade, scale } from "svelte/transition";
	import { backOut } from "svelte/easing";
	import MlInternFlask from "$lib/components/icons/MlInternFlask.svelte";
	import LucideX from "~icons/lucide/x";

	interface Props {
		ontry: () => void;
		ondismiss: () => void;
	}

	let { ontry, ondismiss }: Props = $props();
</script>

<!-- HuggingChat launch card for ML Intern: the CTA hands over to the composer pill. -->
<section
	in:scale={{ start: 0.94, duration: 450, delay: 150, easing: backOut }}
	out:fade={{ duration: 150 }}
	aria-labelledby="ml-intern-spotlight-title"
	class="ml-intern-spotlight relative isolate mx-auto flex w-full max-w-[22.5rem] items-center gap-3 rounded-2xl border border-gray-200/80 bg-white py-3 pr-3 pl-3.5 text-left shadow-sm shadow-black/5 dark:border-gray-700/60 dark:bg-[#141414] dark:shadow-black/20"
>
	<span class="spotlight-light" aria-hidden="true"></span>
	<span class="mr-2 grid w-9 flex-none place-items-center">
		<MlInternFlask />
	</span>

	<div class="min-w-0 flex-1">
		<h2
			id="ml-intern-spotlight-title"
			class="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100"
		>
			Have an ML idea?
			<span
				class="rounded-md bg-[#ea580c]/20 px-[5px] py-[3px] text-[10px] leading-none font-bold text-[#c2410c] dark:bg-[#ea580c]/25 dark:text-[#fdba74]"
			>
				NEW
			</span>
		</h2>
		<p class="mt-0.5 text-[13px] leading-snug text-pretty text-gray-500 dark:text-gray-400">
			ML Intern plans and runs it for you. No PhD required.
		</p>
	</div>

	<button
		type="button"
		onclick={ontry}
		class="flex-none rounded-lg bg-[#ea580c] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#c2410c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ea580c]/60"
	>
		Try it
	</button>

	<button
		type="button"
		class="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full border border-gray-200 bg-white text-gray-400 shadow-sm hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500/60 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400 dark:hover:text-gray-100"
		aria-label="Dismiss"
		onclick={ondismiss}
	>
		<LucideX class="size-3" />
	</button>
</section>

<style>
	.spotlight-light {
		position: absolute;
		inset: 0;
		z-index: -1;
		overflow: hidden;
		border-radius: inherit;
		pointer-events: none;
		background:
			radial-gradient(ellipse 95px 100px at 16px 0, #ffad4724, #ff98000d 55%, transparent 80%),
			radial-gradient(ellipse 58px 45px at 35px 61%, #ff980018, transparent);
	}

	.spotlight-light::before {
		position: absolute;
		inset: 0;
		content: "";
		background: conic-gradient(
			from 106deg at 16px 0,
			transparent 0deg,
			#ffbf632b 5deg,
			#ffb84d12 18deg,
			transparent 19deg,
			#ffb84d1f 31deg,
			transparent 32deg 360deg
		);
		mask-image: radial-gradient(ellipse 155px 110px at 16px 0, #000, transparent 85%);
	}

	:global(.dark) .spotlight-light {
		background:
			radial-gradient(
				ellipse 90px 100px at 16px 0,
				#ff8800b3,
				#d15d0040 40%,
				#b84b0010 65%,
				transparent 90%
			),
			radial-gradient(ellipse 65px 65px at 30px 60%, #fb720021, transparent);
	}

	:global(.dark) .spotlight-light::before {
		opacity: 1;
		background: conic-gradient(
			from 106deg at 16px 0,
			transparent 0deg,
			#ffb84d26 5deg,
			#ffb84d0a 18deg,
			transparent 19deg,
			#ffb84d12 31deg,
			transparent 32deg 360deg
		);
	}
</style>
