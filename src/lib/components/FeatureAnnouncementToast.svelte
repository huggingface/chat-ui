<script lang="ts">
	import { fade, fly } from "svelte/transition";
	import { cubicOut } from "svelte/easing";
	import { base } from "$app/paths";
	import IconSparkles from "~icons/lucide/sparkles";
	import IconArrowRight from "~icons/lucide/arrow-right";
	import IconArrowUpRight from "~icons/lucide/arrow-up-right";
	import type { FeatureAnnouncement } from "$lib/utils/featureAnnouncements";

	interface Props {
		announcement: FeatureAnnouncement;
	}

	let { announcement }: Props = $props();

	let isExternal = $derived(Boolean(announcement.link && !announcement.link.startsWith("/")));
	// App-relative links need the SvelteKit base (e.g. "/chat") prefixed, the same
	// way the rest of the app builds internal links; external URLs are left as-is.
	let href = $derived(
		announcement.link && (isExternal ? announcement.link : `${base}${announcement.link}`)
	);
</script>

<aside
	in:fly={{ y: -8, duration: 400, delay: 300, easing: cubicOut }}
	out:fade={{ duration: 150 }}
	class="pointer-events-auto absolute top-4 right-4 z-10 w-[calc(100%-2rem)] max-w-sm sm:top-5 sm:right-5"
	aria-label="Feature announcement"
>
	<div
		class="rounded-2xl border border-gray-200/80 bg-white/85 p-4 shadow-md shadow-black/5 backdrop-blur-md dark:border-gray-700/60 dark:bg-gray-800/85 dark:shadow-black/20"
	>
		<div
			class="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-blue-600 uppercase dark:text-blue-400"
		>
			<IconSparkles class="size-3.5" />
			New
		</div>
		<h2 class="mt-1.5 text-sm font-semibold text-gray-800 dark:text-gray-100">
			{announcement.title}
		</h2>
		<p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
			{announcement.description}
		</p>
		{#if href}
			<a
				{href}
				target={isExternal ? "_blank" : undefined}
				rel={isExternal ? "noopener noreferrer" : undefined}
				class="mt-2.5 inline-flex items-center gap-0.5 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
			>
				{announcement.cta ?? "Learn more"}
				{#if isExternal}
					<IconArrowUpRight class="size-3.5" />
				{:else}
					<IconArrowRight class="size-3.5" />
				{/if}
			</a>
		{/if}
	</div>
</aside>
