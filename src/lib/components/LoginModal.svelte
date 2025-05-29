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
		class="from-primary-500/40 via-primary-500/10 to-primary-500/0 flex w-full flex-col items-center gap-6 bg-gradient-to-b px-5 pb-8 pt-9 text-center"
	>
		<h2 class="flex items-center text-2xl font-semibold text-gray-800">
			<Logo classNames="mr-1" />
			{publicConfig.PUBLIC_APP_NAME}
		</h2>
		<p class="text-balance text-lg font-semibold leading-snug text-gray-800">
			{publicConfig.PUBLIC_APP_DESCRIPTION}
		</p>
		<p class="text-balance rounded-xl border bg-white/80 p-2 text-base text-gray-800">
			{publicConfig.PUBLIC_APP_GUEST_MESSAGE}
		</p>

		<div class="flex w-full flex-col items-center gap-2">
			{#if page.data.loginRequired}
				<a
					href="{base}/login"
					class="flex w-full flex-wrap items-center justify-center whitespace-nowrap rounded-full bg-black px-5 py-2 text-center text-lg font-semibold text-gray-100 transition-colors hover:bg-gray-900"
				>
					Sign in
					{#if publicConfig.isHuggingChat}
						<span class="flex items-center">
							&nbsp;with <LogoHuggingFaceBorderless classNames="text-xl mr-1 ml-1.5" /> Hugging Face
						</span>
					{/if}
				</a>
			{:else}
				<button
					class="flex w-full items-center justify-center whitespace-nowrap rounded-full border-2 border-black bg-black px-5 py-2 text-lg font-semibold text-gray-100 transition-colors hover:bg-gray-900"
					onclick={(e) => {
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
		</div>
	</div>
</Modal>
