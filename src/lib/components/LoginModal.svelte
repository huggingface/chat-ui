<script lang="ts">
	import { base } from "$app/paths";
	import { page } from "$app/stores";
	import { PUBLIC_APP_DESCRIPTION, PUBLIC_APP_NAME } from "$env/static/public";
	import LogoHuggingFaceBorderless from "$lib/components/icons/LogoHuggingFaceBorderless.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import { useSettingsStore } from "$lib/stores/settings";
	import { cookiesAreEnabled } from "$lib/utils/cookiesAreEnabled";
	import Logo from "./icons/Logo.svelte";

	const settings = useSettingsStore();
</script>

<Modal on:close>
	<div
		class="flex w-full flex-col items-center gap-6 bg-gradient-to-b from-primary-500/40 via-primary-500/10 to-primary-500/0 px-5 pb-8 pt-9 text-center"
	>
		<h2 class="flex items-center text-2xl font-semibold text-gray-800">
			<Logo classNames="mr-1" />
			{PUBLIC_APP_NAME}
		</h2>
		<p class="text-lg font-semibold leading-snug text-gray-800" style="text-wrap: balance;">
			{PUBLIC_APP_DESCRIPTION}
		</p>
		<p class="rounded-xl border bg-white/80 p-2 text-base text-gray-800">
			You have reached the guest message limit, please Sign In with your Hugging Face account to
			continue.
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
					class="flex w-full items-center justify-center whitespace-nowrap rounded-full bg-black px-5 py-2 text-center text-lg font-semibold text-gray-100 transition-colors hover:bg-gray-900"
				>
					Sign in
					{#if PUBLIC_APP_NAME === "HuggingChat"}
						with <LogoHuggingFaceBorderless classNames="text-xl mr-1 ml-1.5" /> Hugging Face
					{/if}
				</button>
			{:else}
				<button
					class="flex w-full items-center justify-center whitespace-nowrap rounded-full border-2 border-black bg-black px-5 py-2 text-lg font-semibold text-gray-100 transition-colors hover:bg-gray-900"
					on:click={(e) => {
						if (!cookiesAreEnabled()) {
							e.preventDefault();
							window.open(window.location.href, "_blank");
						}
						$settings.ethicsModalAccepted = true;
					}}
				>
					Start chatting
				</button>
			{/if}
		</form>
	</div>
</Modal>
