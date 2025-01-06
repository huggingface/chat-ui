<script lang="ts">
	import CarbonWikis from "~icons/carbon/wikis";
	import CarbonTools from "~icons/carbon/tools";
	import CarbonCamera from "~icons/carbon/camera";
	import CarbonCode from "~icons/carbon/code";
	import CarbonEmail from "~icons/carbon/email";
	import CarbonCloud from "~icons/carbon/cloud-upload";
	import CarbonTerminal from "~icons/carbon/terminal";
	import CarbonGame from "~icons/carbon/game-console";
	import CarbonChat from "~icons/carbon/chat-bot";
	import CarbonSpeaker from "~icons/carbon/volume-up";
	import CarbonVideo from "~icons/carbon/video";

	export let color: string;
	export let icon: string;
	export let size: "xs" | "sm" | "md" | "lg" = "md";

	$: gradientColor = (() => {
		switch (color) {
			case "purple":
				return "#653789";
			case "blue":
				return "#375889";
			case "green":
				return "#37894E";
			case "yellow":
				return "#897C37";
			case "red":
				return "#893737";
			default:
				return "#FFF";
		}
	})();

	let iconEl = CarbonWikis;

	switch (icon) {
		case "wikis":
			iconEl = CarbonWikis;
			break;
		case "tools":
			iconEl = CarbonTools;
			break;
		case "camera":
			iconEl = CarbonCamera;
			break;
		case "code":
			iconEl = CarbonCode;
			break;
		case "email":
			iconEl = CarbonEmail;
			break;
		case "cloud":
			iconEl = CarbonCloud;
			break;
		case "terminal":
			iconEl = CarbonTerminal;
			break;
		case "game":
			iconEl = CarbonGame;
			break;
		case "chat":
			iconEl = CarbonChat;
			break;
		case "speaker":
			iconEl = CarbonSpeaker;
			break;
		case "video":
			iconEl = CarbonVideo;
			break;
	}

	$: sizeClass = (() => {
		switch (size) {
			case "xs":
				return "size-4";
			case "sm":
				return "size-8";
			case "md":
				return "size-14";
			case "lg":
				return "size-24";
		}
	})();
</script>

<div class="flex {sizeClass} relative items-center justify-center">
	<svg xmlns="http://www.w3.org/2000/svg" class="absolute {sizeClass} h-full" viewBox="0 0 52 58">
		<defs>
			<linearGradient id="gradient-{gradientColor}" gradientTransform="rotate(90)">
				<stop offset="0%" stop-color="#0E1523" />
				<stop offset="100%" stop-color={gradientColor} />
			</linearGradient>
			<mask id="mask">
				<path
					d="M22.3043 1.2486C23.4279 0.603043 24.7025 0.263184 26 0.263184C27.2975 0.263184 28.5721 0.603043 29.6957 1.2486L48.3043 11.9373C49.4279 12.5828 50.361 13.5113 51.0097 14.6294C51.6584 15.7475 52 17.0158 52 18.3069V39.6902C52 40.9813 51.6584 42.2496 51.0097 43.3677C50.361 44.4858 49.4279 45.4143 48.3043 46.0598L29.6957 56.7514C28.5721 57.397 27.2975 57.7369 26 57.7369C24.7025 57.7369 23.4279 57.397 22.3043 56.7514L3.6957 46.0598C2.57209 45.4143 1.63904 44.4858 0.990308 43.3677C0.341578 42.2496 3.34785e-05 40.9813 5.18628e-07 39.6902V18.3099C-0.000485629 17.0183 0.340813 15.7494 0.989568 14.6307C1.63832 13.512 2.57166 12.5831 3.6957 11.9373L22.3043 1.2486Z"
					fill="white"
				/>
			</mask>
		</defs>
		<rect width="100%" height="100%" fill="url(#gradient-{gradientColor})" mask="url(#mask)" />
	</svg>
	<svelte:component this={iconEl} class="relative {sizeClass} scale-50 text-clip text-gray-200" />
</div>
