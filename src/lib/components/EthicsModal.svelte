<script lang="ts">
	import { PUBLIC_VERSION } from "$env/static/public";
	import Logo from "$lib/components/icons/Logo.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import { onMount } from "svelte";

	let ethicsModal = false;

	const LOCAL_STORAGE_KEY = "has-seen-ethics-modal";

	onMount(() => {
		ethicsModal = localStorage.getItem(LOCAL_STORAGE_KEY) === null;
	});

	const handleClick = () => {
		ethicsModal = false;
		localStorage.setItem(LOCAL_STORAGE_KEY, "true");
	};
</script>

{#if ethicsModal}
	<Modal>
		<div
			class="flex w-full flex-col items-center gap-6 bg-gradient-to-t from-yellow-500/40 via-yellow-500/10 to-yellow-500/0 px-4 pb-10 pt-9 text-center"
		>
			<h2 class="flex items-center text-2xl font-semibold text-gray-800">
				<Logo classNames="text-3xl mr-1.5" />HuggingChat
				{#if typeof PUBLIC_VERSION !== "undefined"}
					<div
						class="ml-3 flex h-6 items-center rounded-lg border border-gray-100 bg-gray-50 px-2 text-base text-gray-400"
					>
						v{PUBLIC_VERSION}
					</div>
				{/if}
			</h2>
			<p class="px-4 text-lg font-semibold leading-snug text-gray-800 sm:px-12">
				This application is for demonstration purposes only.
			</p>
			<p class="text-gray-800">
				AI is an area of active research with known problems such as biased generation and
				misinformation. Do not use this application for high-stakes decisions or advice.
			</p>
			<button
				type="button"
				on:click={handleClick}
				class="mt-2 rounded-full bg-black px-5 py-2 text-lg font-semibold text-gray-100 transition-colors hover:bg-yellow-500"
			>
				Start chatting
			</button>
		</div>
	</Modal>
{/if}
