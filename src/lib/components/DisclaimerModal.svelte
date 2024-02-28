<script lang="ts">
	import { base } from "$app/paths";
	import { page } from "$app/stores";
	import { PUBLIC_APP_DESCRIPTION, PUBLIC_APP_NAME } from "$env/static/public";
	import LogoHuggingFaceBorderless from "$lib/components/icons/LogoHuggingFaceBorderless.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import { cookiesAreEnabled } from "$lib/utils/cookiesAreEnabled";
	import type { LayoutData } from "../../routes/$types";
	import Logo from "./icons/Logo.svelte";

	export let settings: LayoutData["settings"];
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
			&lt;주의 사항&gt;
			<br />
			1. 고객정보,임직원개인정보,사내 기밀정보 입력금지
			<br />
			2. 악의적인 정보 학습 및 비윤리적 활용 금지
			<br />
			3. 생성물 활용 전, 지적 재산권 저작권 침해 등 법률 침해여부 법무 확인필요
			<br />
			4. ChatGPT 사용 중 이슈 발생 시 즉시 보안담당 문의			
		</p>

		<div class="flex w-full flex-col items-center gap-2">
			{#if $page.data.guestMode || !$page.data.loginEnabled}
				<form action="{base}/settings" method="POST" class="w-full">
					<input type="hidden" name="ethicsModalAccepted" value={true} />
					{#each Object.entries(settings).filter(([k]) => !(k === "customPrompts")) as [key, val]}
						<input type="hidden" name={key} value={val} />
					{/each}
					<input
						type="hidden"
						name="customPrompts"
						value={JSON.stringify(settings.customPrompts)}
					/>
					<button
						type="submit"
						class="w-full justify-center rounded-full border-2 border-gray-300 bg-black px-5 py-2 text-lg font-semibold text-gray-100 transition-colors hover:bg-gray-900"
						class:bg-white={$page.data.loginEnabled}
						class:text-gray-800={$page.data.loginEnabled}
						class:hover:bg-slate-100={$page.data.loginEnabled}
						on:click={(e) => {
							if (!cookiesAreEnabled()) {
								e.preventDefault();
								window.open(window.location.href, "_blank");
							}
						}}
					>
						{#if $page.data.loginEnabled}
							Try as guest
						{:else}
							Start chatting
						{/if}
					</button>
				</form>
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
