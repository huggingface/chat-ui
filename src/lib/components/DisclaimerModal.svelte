<script lang="ts">
	import { base } from "$app/paths";
	import { page } from "$app/state";

	import LogoHuggingFaceBorderless from "$lib/components/icons/LogoHuggingFaceBorderless.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import { useSettingsStore } from "$lib/stores/settings";
	import { cookiesAreEnabled } from "$lib/utils/cookiesAreEnabled";
	import Logo from "./icons/Logo.svelte";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

	const publicConfig = usePublicConfig();

	const settings = useSettingsStore();
</script>

<Modal on:close width="!max-w-[400px] !m-4">
	<div
		class="from-primary-500/40 via-primary-500/10 to-primary-500/0 flex w-full flex-col items-center gap-6 bg-gradient-to-b px-5 pb-8 pt-9 text-center sm:px-6"
	>
		<h2 class="flex items-center text-2xl font-semibold text-gray-800">
			<Logo classNames="mr-1" />
			{publicConfig.PUBLIC_APP_NAME}
		</h2>

		<p class="text-lg font-semibold leading-snug text-gray-800" style="text-wrap: balance;">
			{publicConfig.PUBLIC_APP_DESCRIPTION}
		</p>

		<p class="text-sm text-gray-500">
			{publicConfig.PUBLIC_APP_DISCLAIMER_MESSAGE}
		</p>

		<div class="flex w-full flex-col items-center gap-2">
			<button
				class="w-full justify-center rounded-full border-2 border-gray-300 bg-black px-5 py-2 text-lg font-semibold text-gray-100 transition-colors hover:bg-gray-900"
				class:bg-white={page.data.loginEnabled}
				class:text-gray-800={page.data.loginEnabled}
				class:hover:bg-slate-100={page.data.loginEnabled}
				onclick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					if (!cookiesAreEnabled()) {
						window.open(window.location.href, "_blank");
					}

					$settings.ethicsModalAccepted = true;
				}}
			>
				{#if page.data.loginEnabled}
					{#if page.data.guestMode}
						Continue as guest
					{:else}
						Explore the app
					{/if}
				{:else}
					Start chatting
				{/if}
			</button>
			{#if page.data.loginEnabled}
				<a
					href="{base}/login"
					class="flex w-full flex-wrap items-center justify-center whitespace-nowrap rounded-full border-2 border-black bg-black px-5 py-2 text-lg font-semibold text-gray-100 transition-colors hover:bg-gray-900"
				>
					Sign in
					{#if publicConfig.isHuggingChat}
						<span class="flex items-center">
							&nbsp;with <LogoHuggingFaceBorderless classNames="text-xl mr-1 ml-1.5 flex-none" /> Hugging
							Face
						</span>
					{/if}
				</a>
			{/if}
		</div>
	</div>
</Modal>
