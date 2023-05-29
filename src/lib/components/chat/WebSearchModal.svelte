<script lang="ts">
	import Modal from "$lib/components/Modal.svelte";
	import type { WebSearchMessage } from "$lib/types/WebSearch";
	import IconLoading from "../icons/IconLoading.svelte";
	export let messages: WebSearchMessage[];
</script>

<Modal width="max-w-lg" on:close>
	<div class="p-5 pb-1">
		<p class="mx-auto w-full pb-5 text-center text-xl text-gray-800">Web Search</p>
		{#if messages.length === 0}
			<div class="mx-auto w-fit">
				<IconLoading />
			</div>
		{:else}
			<ol class="border-gray-20 relative border-l">
				{#each messages as message, i}
					{#if message.type === "update"}
						<li class="mb-10 ml-4">
							<div
								class="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-white bg-gray-200"
							/>
							<h3 class="text-md text-gray-900 ">
								{message.message}
							</h3>
							{#if message.args}
								<p class="mb-4 text-base font-normal text-gray-500 ">
									{message.args}
								</p>
							{/if}
							{#if messages.length - 1 === i}
								<IconLoading />
							{/if}
						</li>
					{/if}
					<p />
				{/each}
			</ol>
		{/if}
	</div>
</Modal>
