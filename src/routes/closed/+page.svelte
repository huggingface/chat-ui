<script lang="ts">
	import { base } from "$app/paths";
	import LogoHuggingFaceBorderless from "$lib/components/icons/LogoHuggingFaceBorderless.svelte";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import { SvelteDate } from "svelte/reactivity";

	const publicConfig = usePublicConfig();

	let { data } = $props();

	let nextExportTime = SvelteDate.now() + (data.nextExport || 0) * 1000;

	let seconds = $state(Math.max(0, Math.ceil((nextExportTime - SvelteDate.now()) / 1000)));

	$effect(() => {
		const interval = setInterval(() => {
			seconds = Math.max(0, Math.ceil((nextExportTime - SvelteDate.now()) / 1000));
		}, 1000);

		return () => clearInterval(interval);
	});
</script>

<div
	class="flex h-full items-center justify-center bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-white"
>
	<div class="flex flex-col items-center">
		<div class="hover-tilt">
			<svg
				width="222"
				height="108"
				viewBox="0 0 222 108"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path d="M130 33L109 5L88 33" stroke="#D9D9D9" stroke-width="2" />
				<g filter="url(#filter0_d_2_45)">
					<rect y="28" width="222" height="76" rx="12" fill="#826800" />
					<rect x="0.5" y="28.5" width="221" height="75" rx="11.5" stroke="#FFD21E" />
				</g>
				<path
					d="M24.25 66.2969C24.25 57.1875 31.625 49.8125 40.7344 49.8125H47.1562C51.0268 49.8125 54.7387 51.3501 57.4756 54.0869C60.2124 56.8238 61.75 60.5357 61.75 64.4063C61.75 68.2768 60.2124 71.9887 57.4756 74.7256C54.7387 77.4625 51.0268 79 47.1562 79H29.8438L25.3281 83.375C25.2369 83.4603 25.1226 83.5171 24.9995 83.5383C24.8764 83.5596 24.7498 83.5443 24.6352 83.4945C24.5206 83.4447 24.4231 83.3625 24.3547 83.258C24.2862 83.1534 24.2498 83.0312 24.25 82.9063V66.2969Z"
					fill="#FFD21E"
				/>
				<path
					d="M48.6719 61.5C49.25 61.7188 49.4844 62.9063 50.0781 62.5938C51.1875 62 51.6094 60.6094 51.0156 59.5C50.8759 59.2335 50.6847 58.9974 50.4533 58.8051C50.2219 58.6128 49.9547 58.4682 49.6671 58.3796C49.3796 58.291 49.0773 58.2602 48.7778 58.2889C48.4783 58.3176 48.1874 58.4053 47.9219 58.5469C47.3853 58.835 46.9851 59.3244 46.8093 59.9075C46.6335 60.4905 46.6965 61.1196 46.9844 61.6563C47.25 62.1875 48.1406 61.3281 48.6719 61.5ZM37.875 61.5C37.2969 61.7188 37.0625 62.9063 36.4688 62.5938C35.9363 62.3057 35.5392 61.8191 35.3636 61.2397C35.188 60.6604 35.2483 60.0352 35.5313 59.5C35.671 59.2335 35.8621 58.9974 36.0936 58.8051C36.325 58.6128 36.5922 58.4682 36.8798 58.3796C37.1673 58.291 37.4696 58.2602 37.7691 58.2889C38.0686 58.3176 38.3595 58.4053 38.625 58.5469C39.7344 59.1406 40.1563 60.5313 39.5625 61.6563C39.2813 62.1875 38.4063 61.3281 37.875 61.5ZM43.375 72.5469C47.8906 72.5469 49.3438 68.5156 49.3438 66.4531C49.3438 64.375 46.6719 67.5469 43.375 67.5469C40.0938 67.5469 37.4375 64.375 37.4375 66.4531C37.4375 68.5156 38.875 72.5469 43.375 72.5469Z"
					fill="#32343D"
				/>
				<path
					d="M47 71.375C46.1094 72.0625 44.9219 72.5469 43.375 72.5469C41.9375 72.5469 40.7969 72.125 39.9375 71.4844C40.4063 70.5 41.2969 69.75 42.3594 69.4219C42.5469 69.375 42.7344 69.6875 42.9219 70.0156C43.1094 70.3281 43.2969 70.6406 43.5 70.6406C43.7031 70.6406 43.9062 70.3281 44.1094 70.0156C44.3125 69.7031 44.5156 69.3906 44.7031 69.4531C45.6887 69.7721 46.5121 70.4611 47 71.375Z"
					fill="#FF323D"
				/>
				<path
					d="M87.4186 79.427C85.4734 79.427 83.6823 78.9763 82.0455 78.0748C80.4087 77.1734 79.0921 75.8449 78.0958 74.0895C77.1231 72.3103 76.6368 70.1279 76.6368 67.5422C76.6368 64.9802 77.135 62.7977 78.1313 60.9948C79.1514 59.1682 80.4917 57.7805 82.1523 56.8316C83.8365 55.859 85.6513 55.3727 87.5965 55.3727C89.091 55.3727 90.4313 55.6811 91.6174 56.2978C92.8035 56.8909 93.788 57.5907 94.5708 58.3972L91.7953 61.7421C91.2023 61.1965 90.5736 60.7576 89.9094 60.4255C89.2689 60.0697 88.5335 59.8917 87.7033 59.8917C86.6595 59.8917 85.6987 60.1883 84.821 60.7813C83.967 61.3744 83.2791 62.2284 82.7572 63.3433C82.259 64.4583 82.0099 65.7986 82.0099 67.3642C82.0099 69.7365 82.5199 71.5868 83.54 72.9152C84.5601 74.2437 85.9241 74.9079 87.6321 74.9079C88.581 74.9079 89.4231 74.6944 90.1585 74.2674C90.9176 73.8404 91.5818 73.3304 92.1512 72.7373L94.9267 76.011C92.9814 78.2883 90.4788 79.427 87.4186 79.427ZM98.4505 79V55.7997H103.681V74.5877H112.862V79H98.4505ZM125.012 79.427C122.924 79.427 121.086 78.9407 119.496 77.9681C117.93 76.9955 116.697 75.6077 115.795 73.8048C114.918 71.9782 114.479 69.8076 114.479 67.2931C114.479 64.7548 114.918 62.6079 115.795 60.8525C116.697 59.0733 117.93 57.7212 119.496 56.796C121.086 55.8471 122.924 55.3727 125.012 55.3727C127.099 55.3727 128.926 55.8471 130.491 56.796C132.081 57.7212 133.314 59.0733 134.192 60.8525C135.093 62.6317 135.544 64.7785 135.544 67.2931C135.544 69.8076 135.093 71.9782 134.192 73.8048C133.314 75.6077 132.081 76.9955 130.491 77.9681C128.926 78.9407 127.099 79.427 125.012 79.427ZM125.012 74.9079C126.601 74.9079 127.858 74.22 128.783 72.8441C129.709 71.4682 130.171 69.6179 130.171 67.2931C130.171 64.9683 129.709 63.1536 128.783 61.8488C127.858 60.5441 126.601 59.8917 125.012 59.8917C123.422 59.8917 122.165 60.5441 121.24 61.8488C120.315 63.1536 119.852 64.9683 119.852 67.2931C119.852 69.6179 120.315 71.4682 121.24 72.8441C122.165 74.22 123.422 74.9079 125.012 74.9079ZM146.988 79.427C145.469 79.427 143.951 79.1423 142.433 78.573C140.938 78.0037 139.598 77.1734 138.412 76.0822L141.401 72.4882C142.231 73.1999 143.156 73.7811 144.177 74.2318C145.197 74.6826 146.181 74.9079 147.13 74.9079C148.221 74.9079 149.028 74.7063 149.55 74.303C150.095 73.8997 150.368 73.3541 150.368 72.6662C150.368 71.9308 150.06 71.397 149.443 71.0649C148.85 70.7091 148.043 70.3177 147.023 69.8907L143.999 68.6097C143.216 68.2776 142.469 67.8387 141.757 67.2931C141.045 66.7237 140.464 66.0239 140.013 65.1937C139.563 64.3634 139.337 63.3908 139.337 62.2758C139.337 60.9948 139.681 59.8324 140.369 58.7887C141.081 57.7449 142.053 56.9146 143.287 56.2978C144.544 55.6811 145.979 55.3727 147.593 55.3727C148.921 55.3727 150.249 55.6336 151.578 56.1555C152.906 56.6774 154.069 57.4365 155.065 58.4328L152.396 61.7421C151.637 61.149 150.878 60.6983 150.119 60.3899C149.36 60.0578 148.518 59.8917 147.593 59.8917C146.691 59.8917 145.968 60.0815 145.422 60.4611C144.9 60.8169 144.639 61.3269 144.639 61.9912C144.639 62.7028 144.971 63.2366 145.635 63.5924C146.323 63.9482 147.166 64.3278 148.162 64.7311L151.151 65.9409C152.55 66.5102 153.665 67.2931 154.496 68.2894C155.326 69.2857 155.741 70.6023 155.741 72.2392C155.741 73.5202 155.397 74.7063 154.709 75.7975C154.021 76.8887 153.025 77.7664 151.72 78.4307C150.415 79.0949 148.838 79.427 146.988 79.427ZM159.679 79V55.7997H174.197V60.212H164.91V64.8734H172.809V69.2502H164.91V74.5877H174.553V79H159.679ZM179.173 79V55.7997H185.721C188.093 55.7997 190.145 56.2029 191.877 57.0095C193.608 57.8161 194.949 59.0733 195.897 60.7813C196.87 62.4656 197.356 64.6362 197.356 67.2931C197.356 69.95 196.882 72.1443 195.933 73.876C194.984 75.6077 193.656 76.9006 191.948 77.7546C190.263 78.5849 188.283 79 186.005 79H179.173ZM184.404 74.7656H185.4C186.729 74.7656 187.879 74.5284 188.852 74.0539C189.848 73.5795 190.619 72.7966 191.165 71.7054C191.71 70.6142 191.983 69.1434 191.983 67.2931C191.983 65.4427 191.71 63.9957 191.165 62.9519C190.619 61.8844 189.848 61.1372 188.852 60.7102C187.879 60.2594 186.729 60.0341 185.4 60.0341H184.404V74.7656Z"
					fill="white"
				/>
				<circle cx="109" cy="5" r="5" fill="#FF0000" />
				<defs>
					<filter
						id="filter0_d_2_45"
						x="0"
						y="28"
						width="222"
						height="80"
						filterUnits="userSpaceOnUse"
						color-interpolation-filters="sRGB"
					>
						<feFlood flood-opacity="0" result="BackgroundImageFix" />
						<feColorMatrix
							in="SourceAlpha"
							type="matrix"
							values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
							result="hardAlpha"
						/>
						<feOffset dy="4" />
						<feComposite in2="hardAlpha" operator="out" />
						<feColorMatrix
							type="matrix"
							values="0 0 0 0 1 0 0 0 0 0.823529 0 0 0 0 0.117647 0 0 0 1 0"
						/>
						<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_2_45" />
						<feBlend
							mode="normal"
							in="SourceGraphic"
							in2="effect1_dropShadow_2_45"
							result="shape"
						/>
					</filter>
				</defs>
			</svg>
		</div>

		<!-- Subtitle / extra info -->
		<p
			class="mx-2 mt-12 flex flex-wrap justify-center text-center text-2xl font-black text-black dark:text-white max-sm:text-xl"
		>
			<span class="text-nowrap">We are cooking something new,&nbsp;</span>
			<span class="text-nowrap">please stay tuned...</span>
		</p>

		<div class="mt-6 flex flex-col items-center space-y-4 text-center">
			{#if data.nextExport !== Infinity}
				{#if seconds <= 0}
					<button
						onclick={() => {
							window.open(`${base}/api/v2/export`, "_blank");
							nextExportTime = SvelteDate.now() + 3600 * 1000;
							seconds = 3600;
						}}
						class="flex flex-wrap items-center justify-center whitespace-nowrap rounded-full bg-black px-5 py-2 text-center text-lg font-semibold text-white transition-colors hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-300"
						>Export your data</button
					>
				{:else}
					<button
						disabled
						class="flex cursor-not-allowed flex-wrap items-center justify-center whitespace-nowrap rounded-full bg-gray-400 px-5 py-2 text-center text-lg font-semibold text-gray-300 opacity-50 dark:bg-gray-600 dark:text-gray-500"
						>Export your data</button
					>
					<p class="text-sm text-gray-500 dark:text-gray-400">
						You can export your data again in {seconds}
						{seconds === 1 ? "second" : "seconds"}.
					</p>
				{/if}

				<form action="{base}/logout" method="POST" class="w-full">
					<button
						type="submit"
						class="mt-4 text-sm text-gray-500 underline hover:underline dark:text-gray-400"
						>Log out</button
					>
				</form>
			{:else}
				<a
					href="{base}/login"
					class="mt-10 flex w-full max-w-xs flex-wrap items-center justify-center whitespace-nowrap rounded-full bg-black px-5 py-2 text-center text-lg font-semibold text-gray-100 transition-colors hover:bg-gray-900 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
				>
					Sign in
					{#if publicConfig.isHuggingChat}
						<span class="flex items-center">
							&nbsp;with <LogoHuggingFaceBorderless classNames="text-xl mr-1 ml-1.5" /> Hugging Face
						</span>
					{/if}
				</a>
				<p class="text-sm text-gray-500 dark:text-gray-400">to export your existing data.</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.hover-tilt {
		transition: transform 0.3s ease-in-out;
		transform-origin: 49.1% 4.6%; /* Red point at (109, 5) in 222x108 SVG */
	}

	.hover-tilt:hover {
		transform: rotate(3deg);
	}
</style>
