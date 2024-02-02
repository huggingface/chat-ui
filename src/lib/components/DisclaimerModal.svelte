<script lang="ts">
	import { base } from "$app/paths";
	import { page } from "$app/stores";
	import {
		PUBLIC_APP_DESCRIPTION,
		PUBLIC_APP_NAME,
		PUBLIC_APP_DISCLAIMER_MESSAGE,
	} from "$env/static/public";
	import LogoHuggingFaceBorderless from "$lib/components/icons/LogoHuggingFaceBorderless.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import { useSettingsStore } from "$lib/stores/settings";
	import { cookiesAreEnabled } from "$lib/utils/cookiesAreEnabled";
	import Logo from "./icons/Logo.svelte";

	const settings = useSettingsStore();
</script>

<Modal>
	<div
		class="flex w-full flex-col items-center gap-6 bg-gradient-to-b from-primary-500/40 via-primary-500/10 to-primary-500/0 px-5 pb-8 pt-9 text-center sm:px-6"
	>
		<h2 class="flex items-center text-2xl font-semibold text-gray-800">
			<Logo classNames="mr-1" />
			{PUBLIC_APP_NAME}
		</h2>

		<p class="text-lg font-semibold leading-snug text-gray-800" style="text-wrap: balance;">
			{PUBLIC_APP_DESCRIPTION}
		</p>

		<p class="text-sm text-gray-500">
			{PUBLIC_APP_DISCLAIMER_MESSAGE}
		</p>

		<div class="flex w-full flex-col items-center gap-2">
			{#if $page.data.guestMode || !$page.data.loginEnabled}
				<button
					class="w-full justify-center rounded-full border-2 border-gray-300 bg-black px-5 py-2 text-lg font-semibold text-gray-100 transition-colors hover:bg-gray-900"
					class:bg-white={$page.data.loginEnabled}
					class:text-gray-800={$page.data.loginEnabled}
					class:hover:bg-slate-100={$page.data.loginEnabled}
					on:click|preventDefault|stopPropagation={() => {
						if (!cookiesAreEnabled()) {
							window.open(window.location.href, "_blank");
						}

						$settings.ethicsModalAccepted = true;
					}}
				>
					{#if $page.data.loginEnabled}
						Try as guest
					{:else}
						Start chatting
					{/if}
				</button>
			{/if}
			{#if $page.data.loginEnabled}
				<form action="{base}/login" target="_parent" method="POST" class="w-full">
					<button
						type="submit"
						class="flex w-full items-center justify-center whitespace-nowrap rounded-full border-2 border-black bg-black px-5 py-2 text-lg font-semibold text-gray-100 transition-colors hover:bg-gray-900"
					>
						Sign in
						{#if PUBLIC_APP_NAME === "HuggingChat"}
							with <LogoHuggingFaceBorderless classNames="text-xl mr-1 ml-1.5 flex-none" /> Hugging Face
						{/if}
					</button>
				</form>
			{/if}
		</div>
	</div>
</Modal>
