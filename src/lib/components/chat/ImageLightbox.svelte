<script lang="ts">
	import { onMount } from "svelte";
	import Portal from "../Portal.svelte";
	import PinchZoomImage from "./PinchZoomImage.svelte";
	import CarbonClose from "~icons/carbon/close";

	interface Props {
		src: string;
		onclose: () => void;
	}

	let { src, onclose }: Props = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			onclose();
		}
	}

	onMount(() => {
		// iOS Safari needs html-level lock too — body-only leaves the rubber-band bounce
		// on the page underneath the overlay.
		const originalBodyOverflow = document.body.style.overflow;
		const originalHtmlOverflow = document.documentElement.style.overflow;
		document.body.style.overflow = "hidden";
		document.documentElement.style.overflow = "hidden";

		return () => {
			document.body.style.overflow = originalBodyOverflow;
			document.documentElement.style.overflow = originalHtmlOverflow;
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<Portal>
	<div class="fixed inset-0 z-50 overflow-hidden bg-black/90 backdrop-blur-sm">
		<button
			class="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full border border-white/25 bg-white/20 text-gray-300 hover:bg-white/30 sm:right-6 sm:top-6"
			onclick={onclose}
			aria-label="Close"
		>
			<CarbonClose />
		</button>

		<PinchZoomImage
			{src}
			onTapEmpty={onclose}
			class="absolute inset-0"
			imgClass="h-auto max-h-[calc(100vh-160px)] w-auto max-w-full"
		/>
	</div>
</Portal>
