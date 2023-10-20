<script lang="ts">
	import { base } from "$app/paths";
	import { page } from "$app/stores";
	import { PUBLIC_APP_DESCRIPTION, PUBLIC_APP_NAME } from "$env/static/public";
	import LogoHuggingFaceBorderless from "$lib/components/icons/LogoHuggingFaceBorderless.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import type { LayoutData } from "../../routes/$types";
	import Logo from "./icons/Logo.svelte";
	export let settings: LayoutData["settings"];
</script>

<Modal on:close>
	<div
		class="flex w-full flex-col items-center gap-6 bg-gradient-to-b from-primary-500/40 via-primary-500/10 to-primary-500/0 px-4 pb-10 pt-9 text-center"
	>
		<h2 class="flex items-center text-2xl font-semibold text-gray-800">
			<Logo classNames="mr-1" />
			{PUBLIC_APP_NAME}
		</h2>
		<p
			class="px-2 text-lg font-semibold leading-snug text-gray-800 sm:px-8"
			style="text-wrap: balance;"
		>
			{PUBLIC_APP_DESCRIPTION}
		</p>
		<p class="rounded-3xl bg-white bg-opacity-50 p-2 text-base text-gray-800">
			You have reached the guest message limit, please sign in to continue.
		</p>

		<form
			action="{base}/{$page.data.loginRequired ? 'login' : 'settings'}"
			target="_parent"
			method="POST"
			class="flex w-full flex-col items-center gap-2"
		>
			{#if $page.data.loginRequired}
				<button
					type="submit"
					class="mt-2 flex items-center whitespace-nowrap rounded-full bg-black px-5 py-2 text-lg font-semibold text-gray-100 transition-colors hover:bg-primary-500"
				>
					Sign in
					{#if PUBLIC_APP_NAME === "HuggingChat"}
						with <LogoHuggingFaceBorderless classNames="text-xl mr-1 ml-1.5" /> Hugging Face
					{/if}
				</button>
			{:else}
				<input type="hidden" name="ethicsModalAccepted" value={true} />
				{#each Object.entries(settings) as [key, val]}
					<input type="hidden" name={key} value={val} />
				{/each}
				<button
					type="submit"
					class="mt-2 rounded-full bg-black px-5 py-2 text-lg font-semibold text-gray-100 transition-colors hover:bg-primary-500"
				>
					Start chatting
				</button>
			{/if}
		</form>
	</div>
</Modal>
