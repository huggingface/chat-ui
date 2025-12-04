<script lang="ts">
	interface Props {
		frequencyData: Uint8Array;
		pillCount?: number;
		minHeight?: number;
		maxHeight?: number;
	}

	let { frequencyData, pillCount = 28, minHeight = 4, maxHeight = 48 }: Props = $props();

	// Track previous heights for smooth interpolation
	let previousHeights: number[] = $state(Array(pillCount).fill(minHeight));

	// Center-biased weight: loudest at center, decay toward edges
	function getCenterWeight(index: number, total: number): number {
		const center = (total - 1) / 2;
		const distance = Math.abs(index - center) / center;
		// 60% decay toward edges, keeping 40% at the edges
		return 1 - distance * 0.6;
	}

	// Check if audio is active (not silent)
	let isActive = $derived(frequencyData.some((v) => v > 10));

	// Compute target heights from frequency data with center-biased distribution
	let targetHeights = $derived.by(() => {
		if (!frequencyData.length) return Array(pillCount).fill(minHeight);

		const heights: number[] = [];
		const binCount = frequencyData.length;

		for (let i = 0; i < pillCount; i++) {
			// Map pill index to frequency bin (use center bins which have more energy)
			const binIndex = Math.floor((i / pillCount) * binCount);
			const value = frequencyData[binIndex] ?? 0;

			// Apply center weighting
			const weight = getCenterWeight(i, pillCount);
			const normalized = (value / 255) * weight;

			// Scale to height range
			const height = minHeight + normalized * (maxHeight - minHeight);
			heights.push(height);
		}
		return heights;
	});

	// Smooth interpolation: lerp previous heights toward target
	$effect(() => {
		const newHeights = targetHeights.map((target, i) => {
			const prev = previousHeights[i] ?? minHeight;
			// Lerp factor of 0.2 for smooth animation
			return prev + (target - prev) * 0.2;
		});
		previousHeights = newHeights;
	});
</script>

<div class="flex h-12 items-center justify-center gap-[3px]">
	{#each previousHeights as height, i (i)}
		<div
			class="w-1 rounded-full bg-white transition-[height] duration-100 ease-out"
			style="height: {Math.max(minHeight, Math.min(maxHeight, height))}px; opacity: {isActive
				? 1
				: 0.5};"
		></div>
	{/each}
</div>
