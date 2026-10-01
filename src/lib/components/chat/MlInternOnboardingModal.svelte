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
<Modal onclose={close} labelledBy="ml-intern-onboarding-title" width="max-w-[600px]! m-4!">
	<div
		class="flex w-full flex-col gap-6 bg-white bg-linear-to-b to-transparent px-6 pb-6 dark:bg-black dark:from-white/10 dark:to-white/5"
	>
		<div
			class="-mx-6 flex flex-col items-center gap-1.5 bg-linear-to-t from-black/5 px-6 pt-5 pb-4 text-center select-none sm:gap-3 sm:pt-8 sm:pb-6 dark:from-white/10"
		>
			<div
				class="hidden size-14 place-items-center rounded-full bg-[#fff4ea] text-[#c2410c] sm:grid dark:bg-[#2b1c0e] dark:text-[#fdba74]"
			>
				<IconFlask class="size-7" />
			</div>
			<h2
				id="ml-intern-onboarding-title"
				class="text-[15px] font-semibold text-gray-900 min-[375px]:text-lg sm:text-2xl dark:text-gray-100"
			>
				ML Intern is experimental
			</h2>
			<p class="text-sm leading-relaxed text-gray-600 sm:text-[15px] dark:text-gray-300">
				Two settings to improve your experience
			</p>
		</div>

		<ol class="flex flex-col gap-5 text-gray-700 dark:text-gray-200">
			<li class="grid grid-cols-[1rem_1fr] gap-x-2 gap-y-1.5 sm:grid-cols-[2rem_1fr] sm:gap-x-3.5">
				<div
					class="grid size-4 place-items-center self-center text-gray-600 sm:row-span-3 sm:mt-0.5 sm:size-8 sm:self-start sm:rounded-lg sm:bg-gray-500/10 dark:text-gray-300 sm:dark:bg-gray-500/15"
				>
					<IconWrench class="size-4" />
				</div>
				<p class="text-[15px] leading-snug font-semibold text-gray-900 dark:text-gray-100">
					Enable all MCP tools
				</p>
				<p class="col-span-2 text-sm leading-relaxed sm:col-span-1 sm:col-start-2">
					ML Intern is powered by the Hugging Face MCP. Enable all tools for the best experience.
				</p>
				<a
					href={MCP_SETTINGS_URL}
					target="_blank"
					rel="noopener noreferrer"
					class="col-span-2 inline-flex items-center gap-1 justify-self-start pt-[5px] text-sm font-medium text-[#c2410c] underline decoration-[#c2410c]/30 underline-offset-2 hover:decoration-[#c2410c] sm:col-span-1 sm:col-start-2 sm:pt-0 dark:text-[#fdba74] dark:decoration-[#fdba74]/30 dark:hover:decoration-[#fdba74]"
				>
					Open MCP settings
					<CarbonArrowUpRight class="size-3.5" />
				</a>
			</li>
			<li class="grid grid-cols-[1rem_1fr] gap-x-2 gap-y-1.5 sm:grid-cols-[2rem_1fr] sm:gap-x-3.5">
				<div
					class="grid size-4 place-items-center self-center text-gray-600 sm:row-span-4 sm:mt-0.5 sm:size-8 sm:self-start sm:rounded-lg sm:bg-gray-500/10 dark:text-gray-300 sm:dark:bg-gray-500/15"
				>
					<IconWallet class="size-4" />
				</div>
				<p class="text-[15px] leading-snug font-semibold text-gray-900 dark:text-gray-100">
					Cap what ML Intern can spend
				</p>
				<p class="col-span-2 text-sm leading-relaxed sm:col-span-1 sm:col-start-2">
					The session budget caps compute spending from this chat, but not spending by jobs it
					starts. Check your credits in billing settings.
				</p>
				<p class="col-span-2 mt-[5px] text-sm leading-relaxed sm:col-span-1 sm:col-start-2 sm:mt-0">
					Jobs and sandboxes bill to the organization set in HuggingChat's settings.
				</p>
				<a
					href={BILLING_SETTINGS_URL}
					target="_blank"
					rel="noopener noreferrer"
					class="col-span-2 inline-flex items-center gap-1 justify-self-start pt-[5px] text-sm font-medium text-[#c2410c] underline decoration-[#c2410c]/30 underline-offset-2 hover:decoration-[#c2410c] sm:col-span-1 sm:col-start-2 sm:pt-0 dark:text-[#fdba74] dark:decoration-[#fdba74]/30 dark:hover:decoration-[#fdba74]"
				>
					Open Hugging Face billing
					<CarbonArrowUpRight class="size-3.5" />
				</a>
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
