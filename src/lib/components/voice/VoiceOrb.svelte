<script lang="ts">
	/**
	 * Audio-reactive orb for voice mode: scales with the mic level while
	 * listening, with the TTS output level while speaking, and gently pulses
	 * while the model thinks. Level is a smoothed value in [0, 1].
	 */
	interface Props {
		level?: number;
		state?: "connecting" | "listening" | "transcribing" | "thinking" | "speaking" | "error";
		onclick?: () => void;
		label?: string;
	}

	let { level = 0, state = "listening", onclick, label = "Voice orb" }: Props = $props();

	let scale = $derived(1 + Math.min(1, level) * 0.35);
	let glowScale = $derived(1 + Math.min(1, level) * 0.7);
	let pulsing = $derived(
		state === "thinking" || state === "transcribing" || state === "connecting"
	);
</script>

<button
	type="button"
	class="group relative grid size-44 place-items-center focus:outline-none sm:size-52"
	{onclick}
	aria-label={label}
>
	<!-- Outer glow -->
	<div
		class="absolute inset-0 rounded-full bg-blue-500/25 blur-2xl transition-transform duration-100 ease-out dark:bg-blue-400/20"
		class:animate-pulse={pulsing}
		style="transform: scale({glowScale});"
	></div>

	<!-- Core sphere -->
	<div
		class={[
			"relative size-32 rounded-full shadow-xl transition-transform duration-75 ease-out sm:size-36",
			state === "error"
				? "bg-gradient-to-br from-red-400 via-red-500 to-rose-600"
				: state === "speaking"
					? "bg-gradient-to-br from-sky-300 via-blue-500 to-indigo-600"
					: "bg-gradient-to-br from-blue-300 via-blue-500 to-indigo-600",
		]}
		class:animate-pulse={pulsing}
		style="transform: scale({scale});"
	>
		<!-- Specular highlight -->
		<div
			class="absolute top-4 left-6 h-10 w-14 rounded-full bg-white/40 blur-md sm:left-7 sm:h-11 sm:w-16"
		></div>
		<!-- Inner shading -->
		<div
			class="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_35%_30%,transparent_45%,rgba(0,0,50,0.25)_100%)]"
		></div>
	</div>
</button>
