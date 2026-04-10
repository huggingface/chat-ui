<script lang="ts">
	import logo from "../../../../../static/huggingchat/fulltext-logo.svg?raw";

	interface Props {
		title: string;
		isHuggingChat?: boolean;
	}

	let { title, isHuggingChat = false }: Props = $props();

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
	<!-- Shared conversation label -->
	<div
		style="display: flex; align-items: center; justify-content: center; padding: 14px 40px; border-radius: 9999px; background-color: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); margin-bottom: 40px; font-size: 32px; font-weight: 700; color: rgba(255,255,255,0.8); letter-spacing: 0.02em;"
	>
		Shared conversation
	</div>

	<!-- Conversation title -->
	<div
		style="font-size: 58px; font-weight: 700; color: white; text-align: center; max-width: 1050px; line-height: 1.2; overflow: hidden; display: flex; align-items: center; justify-content: center;"
	>
		{displayTitle}
	</div>

	<!-- HuggingChat branding -->
	{#if isHuggingChat}
		<div
			style="display: flex; align-items: center; margin-top: 40px; font-size: 28px; color: white;"
		>
			<!-- eslint-disable-next-line -->
			{@html logo}
		</div>
	{/if}
</div>
