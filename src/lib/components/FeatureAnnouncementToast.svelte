<script lang="ts">
	import { fade, fly } from "svelte/transition";
	import { cubicOut } from "svelte/easing";
	import { base } from "$app/paths";
	import IconSparkles from "~icons/lucide/sparkles";
	import IconArrowRight from "~icons/lucide/arrow-right";
	import IconArrowUpRight from "~icons/lucide/arrow-up-right";
	import IconX from "~icons/lucide/x";
	import type { FeatureAnnouncement } from "$lib/utils/featureAnnouncements";

	interface Props {
		announcement: FeatureAnnouncement;
		ondismiss: () => void;
	}

	let { announcement, ondismiss }: Props = $props();

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
		class="relative rounded-2xl border border-gray-200/80 bg-white/85 p-4 shadow-md shadow-black/5 backdrop-blur-md dark:border-gray-700/60 dark:bg-gray-800/85 dark:shadow-black/20"
	>
		<div
			class="flex items-center gap-1.5 text-xs font-semibold text-blue-600 uppercase dark:text-blue-400"
		>
			<IconSparkles class="size-3.5" />
			New
		</div>
		<h2 class="mt-1.5 pr-5 text-sm font-semibold text-gray-800 dark:text-gray-100">
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
		<button
			type="button"
			class="absolute top-2.5 right-2.5 grid size-6 place-items-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-blue-500/60 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200"
			aria-label="Dismiss announcement"
			onclick={ondismiss}
		>
			<IconX class="size-3.5" />
		</button>
	</div>
</aside>
