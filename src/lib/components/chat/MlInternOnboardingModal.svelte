<script lang="ts">
	import Modal from "$lib/components/Modal.svelte";
	import IconFlask from "~icons/lucide/flask-conical";
	import IconWrench from "~icons/lucide/wrench";
	import IconWallet from "~icons/lucide/wallet";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";

	interface Props {
		close: () => void;
	}

	let { close }: Props = $props();

	const MCP_SETTINGS_URL = "https://huggingface.co/settings/mcp";
	const BILLING_SETTINGS_URL = "https://huggingface.co/settings/billing";
</script>

<!-- Shown once, the first time the mode is switched on (see MlInternPill). Both
     links go to the Hub rather than to in-app settings because the mode runs on
     the Hub's MCP server with the user's own token: which tools it can reach and
     what it can spend are decided on the user's Hugging Face account, not here. -->
<Modal onclose={close} labelledBy="ml-intern-onboarding-title" width="max-w-[440px]! m-4!">
	<div
		class="flex w-full flex-col gap-6 bg-white bg-linear-to-b to-transparent px-6 pb-6 dark:bg-black dark:from-white/10 dark:to-white/5"
	>
		<div
			class="-mx-6 flex flex-col items-center gap-3 bg-linear-to-t from-black/5 px-6 pt-8 pb-6 text-center select-none dark:from-white/10"
		>
			<div
				class="grid size-14 place-items-center rounded-full bg-[#fff4ea] text-[#c2410c] dark:bg-[#2b1c0e] dark:text-[#fdba74]"
			>
				<IconFlask class="size-7" />
			</div>
			<h2
				id="ml-intern-onboarding-title"
				class="text-2xl font-semibold text-gray-900 dark:text-gray-100"
			>
				ML Intern is experimental
			</h2>
			<p class="text-[15px] leading-relaxed text-gray-600 dark:text-gray-300">
				It plans and runs machine-learning work for you on Hugging Face. Two settings on your
				account make a real difference to how well that goes.
			</p>
		</div>

		<ol class="flex flex-col gap-5 text-gray-700 dark:text-gray-200">
			<li class="flex gap-3.5">
				<div
					class="mt-0.5 grid size-8 flex-none place-items-center rounded-lg bg-gray-500/10 text-gray-600 dark:bg-gray-500/15 dark:text-gray-300"
				>
					<IconWrench class="size-4" />
				</div>
				<div class="flex flex-col gap-1.5">
					<p class="text-[15px] leading-snug font-semibold text-gray-900 dark:text-gray-100">
						Enable all MCP tools
					</p>
					<p class="text-sm leading-relaxed">
						ML Intern works through the Hugging Face MCP server and can only use the tools you have
						switched on there. For the best experience, enable all of them.
					</p>
					<a
						href={MCP_SETTINGS_URL}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center gap-1 self-start text-sm font-medium text-[#c2410c] underline decoration-[#c2410c]/30 underline-offset-2 hover:decoration-[#c2410c] dark:text-[#fdba74] dark:decoration-[#fdba74]/30 dark:hover:decoration-[#fdba74]"
					>
						Open MCP settings
						<CarbonArrowUpRight class="size-3.5" />
					</a>
				</div>
			</li>
			<li class="flex gap-3.5">
				<div
					class="mt-0.5 grid size-8 flex-none place-items-center rounded-lg bg-gray-500/10 text-gray-600 dark:bg-gray-500/15 dark:text-gray-300"
				>
					<IconWallet class="size-4" />
				</div>
				<div class="flex flex-col gap-1.5">
					<p class="text-[15px] leading-snug font-semibold text-gray-900 dark:text-gray-100">
						Set a spending cap
					</p>
					<p class="text-sm leading-relaxed">
						A budget you give ML Intern in the chat is strictly enforced on the Jobs it launches
						from here, but it is not a guarantee: a Job it starts could launch Jobs of its own or
						use other Hugging Face products. To make sure you never overspend, set a budget in your
						billing settings too.
					</p>
					<a
						href={BILLING_SETTINGS_URL}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center gap-1 self-start text-sm font-medium text-[#c2410c] underline decoration-[#c2410c]/30 underline-offset-2 hover:decoration-[#c2410c] dark:text-[#fdba74] dark:decoration-[#fdba74]/30 dark:hover:decoration-[#fdba74]"
					>
						Open billing settings
						<CarbonArrowUpRight class="size-3.5" />
					</a>
				</div>
			</li>
		</ol>

		<button
			class="w-full rounded-xl bg-black px-5 py-2.5 text-base font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
			onclick={close}
		>
			Got it
		</button>
	</div>
</Modal>
