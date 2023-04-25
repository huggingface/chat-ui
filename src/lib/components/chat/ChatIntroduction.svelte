<script lang="ts">
	import {
		PUBLIC_DISABLE_INTRO_TILES,
		PUBLIC_MODEL_ID,
		PUBLIC_MODEL_NAME,
	} from "$env/static/public";

	import Logo from "$lib/components/icons/Logo.svelte";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";
	import CarbonEarth from "~icons/carbon/earth";
	import { createEventDispatcher } from "svelte";

	const dispatch = createEventDispatcher<{ message: string }>();
</script>

<div class="grid lg:grid-cols-3 gap-8 my-auto">
	<div class="lg:col-span-1">
		<div>
			<div class="text-2xl font-semibold mb-3 flex items-center">
				<Logo classNames="mr-1 text-yellow-400 text-4xl" />
				HuggingChat
				<div
					class="text-base h-6 px-2 rounded-lg text-gray-400 bg-gray-50 ml-3 flex items-center border border-gray-100 dark:bg-gray-800 dark:border-gray-700/60"
				>
					v0
				</div>
			</div>
			<p class="text-base text-gray-600 dark:text-gray-400">
				Making the best open source AI chat models available to everyone.
			</p>
		</div>
	</div>
	<div class="lg:col-span-2 lg:pl-24">
		<div class="border dark:border-gray-800 rounded-xl overflow-hidden">
			<div class="p-3">
				<div class="text-sm text-gray-600 dark:text-gray-400">Current Model</div>
				<div class="font-semibold">{PUBLIC_MODEL_NAME}</div>
			</div>
			<div
				class="flex items-center gap-5 px-3 py-2 bg-gray-100 rounded-xl text-sm text-gray-600 dark:text-gray-300 dark:bg-gray-800"
			>
				<a
					href="https://huggingface.co/{PUBLIC_MODEL_ID}"
					target="_blank"
					rel="noreferrer"
					class="flex items-center hover:underline"
				>
					<CarbonArrowUpRight class="text-xs mr-1.5 text-gray-400" />
					Model
					<div class="max-sm:hidden">&nbsp;page</div>
				</a>
				<a
					href="https://huggingface.co/datasets/OpenAssistant/oasst1"
					target="_blank"
					rel="noreferrer"
					class="flex items-center hover:underline"
				>
					<CarbonArrowUpRight class="text-xs mr-1.5 text-gray-400" />
					Dataset
					<div class="max-sm:hidden">&nbsp;page</div>
				</a>
				<a
					href="https://open-assistant.io/"
					target="_blank"
					class="flex items-center hover:underline ml-auto"
					rel="noreferrer"
				>
					<CarbonEarth class="text-xs mr-1.5 text-gray-400" />
					Open Assistant Website
				</a>
			</div>
		</div>
	</div>
	{#if PUBLIC_DISABLE_INTRO_TILES !== "true"}
		<div class="lg:col-span-3 lg:mt-12">
			<p class="mb-3 text-gray-600 dark:text-gray-300">Examples</p>
			<div class="grid lg:grid-cols-3 gap-3 lg:gap-5">
				<button
					type="button"
					class="text-gray-600 dark:text-gray-300 p-2.5 sm:p-4 bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700 hover:bg-gray-100 border dark:border-gray-800 rounded-xl"
					on:click={() =>
						dispatch(
							"message",
							"As a restaurant owner, write a professional email to the supplier to get these products every week: \n\n- Wine (x10)\n- Eggs (x24)\n- Bread (x12)"
						)}
				>
					"Write an email from bullet list"
				</button>
				<button
					type="button"
					class="text-gray-600 dark:text-gray-300 p-2.5 sm:p-4 bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700 hover:bg-gray-100 border dark:border-gray-800 rounded-xl"
					on:click={() =>
						dispatch(
							"message",
							"Code a basic snake game in python, give explanations for each step."
						)}
				>
					"Code a snake game"
				</button>
				<button
					type="button"
					class="text-gray-600 dark:text-gray-300 p-2.5 sm:p-4 bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700 hover:bg-gray-100 border dark:border-gray-800 rounded-xl"
					on:click={() => dispatch("message", "How do I make a delicious lemon cheesecake?")}
				>
					"Assist in a task"
				</button>
			</div>
		</div>
	{/if}
</div>
