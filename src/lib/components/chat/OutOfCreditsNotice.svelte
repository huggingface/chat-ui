<script lang="ts">
	import { base } from "$app/paths";
	import { isPro } from "$lib/stores/isPro";
	import { useSettingsStore } from "$lib/stores/settings";
	import { outOfCreditsCopy } from "$lib/utils/outOfCredits";

	const settings = useSettingsStore();
	let copy = $derived(
		outOfCreditsCopy({
			isPro: $isPro,
			billingOrganization: $settings.billingOrganization,
			settingsHref: `${base}/settings/application`,
		})
	);
</script>

<div
	role="status"
	class="flex w-full max-w-4xl flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
>
	<span class="min-w-0 flex-1">{copy.notice}</span>
	<div class="flex shrink-0 items-center gap-2">
		{#if copy.secondary}
			<a
				href={copy.secondary.href}
				target={copy.secondary.external ? "_blank" : undefined}
				rel={copy.secondary.external ? "noopener noreferrer" : undefined}
				class="rounded-lg px-2.5 py-1 font-medium hover:bg-amber-100 dark:hover:bg-amber-500/15"
			>
				{copy.secondary.label}
			</a>
		{/if}
		<a
			href={copy.primary.href}
			target={copy.primary.external ? "_blank" : undefined}
			rel={copy.primary.external ? "noopener noreferrer" : undefined}
			class="rounded-lg bg-black px-2.5 py-1 font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
		>
			{copy.primary.label}
		</a>
	</div>
</div>
