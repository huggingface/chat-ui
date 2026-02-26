<script lang="ts">
	import logo from "../../../../../static/huggingchat/fulltext-logo.svg?raw";

	interface Props {
		title: string;
		modelName?: string;
		isHuggingChat?: boolean;
	}

	let { title, modelName = "", isHuggingChat = false }: Props = $props();

	// Satori doesn't reliably support text-overflow: ellipsis,
	// so we truncate manually for predictable rendering.
	function truncateTitle(text: string, maxLength: number): string {
		if (text.length <= maxLength) return text;
		return text.substring(0, maxLength - 1).trimEnd() + "\u2026";
	}

	const displayTitle = truncateTitle(title, 80);
</script>

<div
	class="flex h-[648px] w-[1200px] flex-col items-center justify-center bg-black text-white"
	style="background-image: url(https://cdn-uploads.huggingface.co/production/uploads/5f17f0a0925b9863e28ad517/L4XVRJ7MsfFDD7ROx_geO.png);"
>
	<!-- Chat bubble icon -->
	<div
		style="display: flex; align-items: center; justify-content: center; width: 72px; height: 72px; border-radius: 18px; background: linear-gradient(135deg, rgba(255,210,0,0.25), rgba(255,150,0,0.15)); border: 1px solid rgba(255,210,0,0.3); margin-bottom: 32px;"
	>
		<svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M12 2C6.48 2 2 5.58 2 10c0 2.24 1.12 4.26 2.94 5.7L4 22l4.73-2.84C9.77 19.72 10.86 20 12 20c5.52 0 10-3.58 10-8s-4.48-8-10-8z"
				fill="rgba(255,210,0,0.9)"
			/>
		</svg>
	</div>

	<!-- Conversation title -->
	<div
		style="font-size: 48px; font-weight: 700; color: white; text-align: center; max-width: 1000px; line-height: 1.25; overflow: hidden; display: flex; align-items: center; justify-content: center;"
	>
		{displayTitle}
	</div>

	<!-- Model name subtitle -->
	{#if modelName}
		<div style="font-size: 22px; color: rgba(255,255,255,0.5); margin-top: 20px; font-weight: 500;">
			{modelName}
		</div>
	{/if}

	<!-- HuggingChat branding -->
	{#if isHuggingChat}
		<div
			style="display: flex; align-items: center; margin-top: 32px; font-size: 28px; color: white;"
		>
			<div style="margin-right: 12px; font-size: 22px; color: rgba(255,255,255,0.7);">
				Shared on
			</div>
			<!-- eslint-disable-next-line -->
			{@html logo}
		</div>
	{/if}
</div>
