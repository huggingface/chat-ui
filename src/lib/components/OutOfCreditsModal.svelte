<script lang="ts">
	import { base } from "$app/paths";
	import Modal from "$lib/components/Modal.svelte";
	import { isPro } from "$lib/stores/isPro";
	import { useSettingsStore } from "$lib/stores/settings";
	import IconPro from "$lib/components/icons/IconPro.svelte";
	import { outOfCreditsCopy } from "$lib/utils/outOfCredits";

	interface Props {
		close: () => void;
	}

	let { close }: Props = $props();

	const settings = useSettingsStore();
	let copy = $derived(
		outOfCreditsCopy({
			isPro: $isPro,
			billingOrganization: $settings.billingOrganization,
			settingsHref: `${base}/settings/application`,
		})
	);
</script>

<Modal closeOnBackdrop={false} onclose={close} width="max-w-[420px]! m-4!">
	<div
		class="flex w-full flex-col gap-8 bg-white bg-linear-to-b to-transparent px-6 pb-7 dark:bg-black dark:from-white/10 dark:to-white/5"
	>
		<div
			class="-mx-6 grid h-48 place-items-center bg-linear-to-t from-black/5 select-none dark:from-white/10"
		>
			<div class="flex flex-col items-center justify-center gap-2.5 px-8 text-center">
				<div
					class="flex size-14 items-center justify-center rounded-full bg-linear-to-br from-yellow-500/15 via-orange-500/15 to-red-500/15 text-3xl"
				>
					<IconPro classNames="mr-0!" />
				</div>
				<h2 class="text-2xl font-semibold text-gray-900 dark:text-gray-100">{copy.title}</h2>
			</div>
		</div>

		<p class="text-[15px] leading-relaxed text-gray-700 dark:text-gray-200">{copy.body}</p>

		<div class="flex flex-col gap-2.5">
			<a
				href={copy.primary.href}
				target={copy.primary.external ? "_blank" : undefined}
				rel={copy.primary.external ? "noopener noreferrer" : undefined}
				class="w-full rounded-xl bg-black px-5 py-2.5 text-center text-base font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
			>
				{copy.primary.label}
			</a>
			{#if copy.secondary}
				<a
					href={copy.secondary.href}
					target={copy.secondary.external ? "_blank" : undefined}
					rel={copy.secondary.external ? "noopener noreferrer" : undefined}
					onclick={copy.secondary.external ? undefined : close}
					class="w-full rounded-xl border border-gray-300 px-5 py-2.5 text-center text-base font-medium text-gray-800 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-white/10"
				>
					{copy.secondary.label}
				</a>
			{/if}
			<button
				class="w-full rounded-xl px-5 py-2 text-base font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
				onclick={close}
			>
				Not now
			</button>
		</div>
	</div>
</Modal>
