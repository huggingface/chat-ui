<script lang="ts">
	import { Select } from "bits-ui";
	import { PROVIDERS_HUB_ORGS } from "@huggingface/inference";
	import IconFast from "$lib/components/icons/IconFast.svelte";
	import IconCheap from "$lib/components/icons/IconCheap.svelte";
	import CarbonMagicWandFilled from "~icons/carbon/magic-wand-filled";
	import CarbonChevronDown from "~icons/carbon/chevron-down";
	import LucideCheck from "~icons/lucide/check";
	import { useSettingsStore } from "$lib/stores/settings";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import type { Model } from "$lib/types/Model";

	interface Props {
		currentModel?: Model;
	}

	let { currentModel }: Props = $props();

	const settings = useSettingsStore();
	const publicConfig = usePublicConfig();

	type RouterProvider = { provider: string } & Record<string, unknown>;

	const PROVIDER_POLICIES = [
		{ value: "auto", shortLabel: "Auto", label: "Auto (your HF preference order)" },
		{ value: "fastest", shortLabel: "Fastest", label: "Fastest (highest throughput)" },
		{ value: "cheapest", shortLabel: "Cheapest", label: "Cheapest (lowest cost)" },
	] as const;

	let modelId = $derived(currentModel?.id ?? "");
	let providerList = $derived((currentModel?.providers ?? []) as RouterProvider[]);
	let currentValue = $derived($settings.providerOverrides?.[modelId] ?? "auto");
	let currentProvider = $derived(providerList.find((p) => p.provider === currentValue));
	let currentPolicy = $derived(PROVIDER_POLICIES.find((p) => p.value === currentValue));
	let triggerLabel = $derived(
		currentPolicy?.shortLabel ?? currentProvider?.provider ?? currentValue
	);

	let visible = $derived(
		!!currentModel &&
			publicConfig.isHuggingChat &&
			!currentModel.isRouter &&
			(currentModel.providers?.length ?? 0) > 0
	);

	// Auto-mode composition: up to 5 provider micro-avatars stacked inside a 16×16
	// box. Tiles overlap so each logo gets a bigger pixel budget; a thin ring around
	// every tile keeps them visually separated.
	type Slot = { x: number; y: number; w: number; h: number };
	const COMPOSITION_LAYOUTS: Record<number, Slot[]> = {
		1: [{ x: 0, y: 0, w: 16, h: 16 }],
		2: [
			{ x: 0, y: 3, w: 10, h: 10 },
			{ x: 6, y: 3, w: 10, h: 10 },
		],
		3: [
			{ x: 3, y: 0, w: 10, h: 10 },
			{ x: 0, y: 6, w: 10, h: 10 },
			{ x: 6, y: 6, w: 10, h: 10 },
		],
		4: [
			{ x: 0, y: 0, w: 9, h: 9 },
			{ x: 7, y: 0, w: 9, h: 9 },
			{ x: 0, y: 7, w: 9, h: 9 },
			{ x: 7, y: 7, w: 9, h: 9 },
		],
		5: [
			{ x: 0, y: 0, w: 8, h: 8 },
			{ x: 4, y: 0, w: 8, h: 8 },
			{ x: 8, y: 0, w: 8, h: 8 },
			{ x: 1, y: 8, w: 8, h: 8 },
			{ x: 7, y: 8, w: 8, h: 8 },
		],
	};

	let compositionProviders = $derived(providerList.slice(0, 5));
	let compositionLayout = $derived(
		COMPOSITION_LAYOUTS[Math.min(compositionProviders.length, 5)] ?? []
	);

	function setProvider(v: string) {
		settings.update((s) => ({
			...s,
			providerOverrides: { ...s.providerOverrides, [modelId]: v },
		}));
	}
</script>

{#if visible}
	<Select.Root type="single" value={currentValue} onValueChange={(v) => v && setProvider(v)}>
		<Select.Trigger
			aria-label="Select inference provider"
			title="Inference provider"
			class="ml-1.5 inline-flex h-8 items-center gap-1.5 rounded-full border border-gray-200 pl-2 pr-2 text-xs font-normal text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-800 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 sm:h-7"
		>
			{#if currentValue === "auto"}
				{#if compositionLayout.length === 0}
					<CarbonMagicWandFilled class="size-3.5 text-gray-600 dark:text-gray-300" />
				{:else}
					<span class="relative size-4 flex-none" aria-hidden="true">
						{#each compositionLayout as slot, i (compositionProviders[i].provider)}
							{@const hubOrg =
								PROVIDERS_HUB_ORGS[
									compositionProviders[i].provider as keyof typeof PROVIDERS_HUB_ORGS
								]}
							{#if hubOrg}
								<img
									src="https://huggingface.co/api/avatars/{hubOrg}"
									alt=""
									class="absolute rounded-full bg-white object-cover ring-1 ring-white dark:bg-gray-900 dark:ring-gray-700"
									style:left="{slot.x}px"
									style:top="{slot.y}px"
									style:width="{slot.w}px"
									style:height="{slot.h}px"
								/>
							{:else}
								<span
									class="absolute rounded-full bg-gray-300 ring-1 ring-white dark:bg-gray-600 dark:ring-gray-700"
									style:left="{slot.x}px"
									style:top="{slot.y}px"
									style:width="{slot.w}px"
									style:height="{slot.h}px"
								></span>
							{/if}
						{/each}
					</span>
				{/if}
			{:else if currentValue === "fastest"}
				<IconFast classNames="size-3.5" />
			{:else if currentValue === "cheapest"}
				<IconCheap classNames="size-3.5" />
			{:else}
				{@const hubOrg = PROVIDERS_HUB_ORGS[currentValue as keyof typeof PROVIDERS_HUB_ORGS]}
				{#if hubOrg}
					<img
						src="https://huggingface.co/api/avatars/{hubOrg}"
						alt=""
						class="size-4 rounded bg-white p-px shadow-sm ring-1 ring-black/5 dark:bg-gray-900 dark:ring-white/10"
					/>
				{/if}
			{/if}
			<span class="leading-none">{triggerLabel}</span>
			<CarbonChevronDown class="size-3 opacity-80" />
		</Select.Trigger>
		<Select.Portal>
			<Select.Content
				class="scrollbar-custom z-50 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-800/95"
				side="top"
				sideOffset={8}
				align="start"
			>
				<Select.Group>
					<Select.GroupHeading
						class="px-2 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400"
					>
						Selection mode
					</Select.GroupHeading>
					{#each PROVIDER_POLICIES as opt (opt.value)}
						<Select.Item
							value={opt.value}
							class="flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-700 outline-none data-[highlighted]:bg-gray-100 dark:text-gray-200 dark:data-[highlighted]:bg-white/10"
						>
							{#if opt.value === "auto"}
								<span class="grid size-5 flex-none place-items-center rounded-md bg-gray-500/10">
									<CarbonMagicWandFilled class="size-3 text-gray-700 dark:text-gray-300" />
								</span>
							{:else if opt.value === "fastest"}
								<span
									class="grid size-5 flex-none place-items-center rounded-md bg-green-500/10 text-green-600 dark:text-green-500"
								>
									<IconFast classNames="size-3" />
								</span>
							{:else if opt.value === "cheapest"}
								<span
									class="grid size-5 flex-none place-items-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-500"
								>
									<IconCheap classNames="size-3" />
								</span>
							{/if}
							<span class="flex-1">{opt.label}</span>
							{#if currentValue === opt.value}
								<LucideCheck class="size-4 text-gray-500" />
							{/if}
						</Select.Item>
					{/each}
				</Select.Group>
				<div class="my-1 h-px bg-gray-200 dark:bg-gray-700"></div>
				<Select.Group>
					<Select.GroupHeading
						class="px-2 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400"
					>
						Specific provider
					</Select.GroupHeading>
					{#each providerList as prov (prov.provider)}
						{@const hubOrg = PROVIDERS_HUB_ORGS[prov.provider as keyof typeof PROVIDERS_HUB_ORGS]}
						<Select.Item
							value={prov.provider}
							class="flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-700 outline-none data-[highlighted]:bg-gray-100 dark:text-gray-200 dark:data-[highlighted]:bg-white/10"
						>
							{#if hubOrg}
								<span
									class="flex size-5 flex-none items-center justify-center rounded-md bg-gray-500/10 p-0.5"
								>
									<img
										src="https://huggingface.co/api/avatars/{hubOrg}"
										alt=""
										class="size-full rounded"
									/>
								</span>
							{:else}
								<span class="size-5"></span>
							{/if}
							<span class="flex-1">{prov.provider}</span>
							{#if currentValue === prov.provider}
								<LucideCheck class="size-4 text-gray-500" />
							{/if}
						</Select.Item>
					{/each}
				</Select.Group>
			</Select.Content>
		</Select.Portal>
	</Select.Root>
{/if}
