<script lang="ts">
	import { base } from "$app/paths";
	import { page } from "$app/stores";
	import { env as envPublic } from "$env/dynamic/public";
	import LogoHuggingFaceBorderless from "$lib/components/icons/LogoHuggingFaceBorderless.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import { useSettingsStore } from "$lib/stores/settings";
	import { cookiesAreEnabled } from "$lib/utils/cookiesAreEnabled";
	import Logo from "./icons/Logo.svelte";

	const settings = useSettingsStore();
</script>

<Modal on:close>
	<div
		class="from-primary-500/40 via-primary-500/10 to-primary-500/0 flex w-full flex-col items-center gap-6 bg-gradient-to-b px-5 pb-8 pt-9 text-center"
	>
		<h2 class="flex items-center text-2xl font-semibold text-gray-800">
			<Logo classNames="mr-1" />
			{envPublic.PUBLIC_APP_NAME}
		</h2>
		<p class="text-balance text-lg font-semibold leading-snug text-gray-800">
			{envPublic.PUBLIC_APP_DESCRIPTION}
		</p>
		<p class="text-balance rounded-xl border bg-white/80 p-2 text-base text-gray-800">
			{envPublic.PUBLIC_APP_GUEST_MESSAGE}
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
					class="flex w-full flex-wrap items-center justify-center whitespace-nowrap rounded-full bg-black px-5 py-2 text-center text-lg font-semibold text-gray-100 transition-colors hover:bg-gray-900"
				>
					Sign in
					{#if envPublic.PUBLIC_APP_NAME === "HuggingChat"}
						<span class="flex items-center">
							&nbsp;with <LogoHuggingFaceBorderless classNames="text-xl mr-1 ml-1.5" /> Hugging Face
						</span>
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
