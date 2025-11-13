<script lang="ts">
	import Modal from "$lib/components/Modal.svelte";

	interface Props {
		close: () => void;
	}

	const { close }: Props = $props();
</script>

<Modal closeOnBackdrop={false} onclose={close} width="!max-w-[420px] !m-4">
	<div
		class="flex w-full flex-col gap-8 bg-white bg-gradient-to-b to-transparent px-6 pb-7 dark:bg-black dark:from-white/10 dark:to-white/5"
	>
		<div
			class="-mx-6 grid h-48 select-none place-items-center bg-gradient-to-t from-black/5 dark:from-white/10"
		>
			<div class="flex flex-col items-center justify-center gap-2.5 px-8 text-center">
				<div
					class="flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-pink-500/15 from-15% via-green-500/15 to-yellow-500/15 text-3xl"
				>
					<svg
						width="1em"
						height="1em"
						viewBox="0 0 12 12"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
					>
						<path
							d="M6.48 1.26001C6.48 2.81001 7.15 3.84001 7.98 4.50001C8.84 5.18001 9.88 5.50001 10.56 5.57001V6.43001C9.6233 6.5513 8.73602 6.92071 7.99 7.50001C7.50131 7.88332 7.10989 8.37647 6.84753 8.93943C6.58516 9.50238 6.45925 10.1193 6.48 10.74H5.52C5.52 9.19001 4.85 8.16001 4.02 7.50001C3.27114 6.91907 2.3802 6.54958 1.44 6.43001V5.57001C2.37671 5.44872 3.26398 5.07931 4.01 4.50001C4.4987 4.1167 4.89011 3.62355 5.15248 3.06059C5.41484 2.49764 5.54076 1.88075 5.52 1.26001H6.48Z"
							fill="url(#paint0_linear_141_2)"
						/>
						<defs>
							<linearGradient
								id="paint0_linear_141_2"
								x1="3.37"
								y1="3.43001"
								x2="8.14"
								y2="8.90001"
								gradientUnits="userSpaceOnUse"
							>
								<stop stop-color="#FF0789" />
								<stop offset="0.63" stop-color="#21DE75" />
								<stop offset="1" stop-color="#FF8D00" />
							</linearGradient>
						</defs>
					</svg>
				</div>
				<h2 class="text-2xl font-semibold text-gray-900 dark:text-gray-100">Upgrade Required</h2>
			</div>
		</div>

		<div class="text-gray-700 dark:text-gray-200">
			<p class="text-[15px] leading-relaxed">
				You've reached your message limit. Upgrade to Hugging Face PRO to continue using
				HuggingChat.
			</p>
			<p class="mt-3 text-[15px] italic leading-relaxed opacity-75">
				It's also possible to use your PRO credits in your favorite AI tools.
			</p>
		</div>

		<div class="flex flex-col gap-2.5">
			<a
				href="https://huggingface.co/subscribe/pro?from=HuggingChat"
				target="_blank"
				rel="noopener noreferrer"
				class="w-full rounded-xl bg-black px-5 py-2.5 text-center text-base font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
			>
				Upgrade to Pro
			</a>
			<button
				class="w-full rounded-xl bg-gray-200 px-5 py-2.5 text-base font-medium text-gray-700 hover:bg-gray-300/80 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10"
				onclick={close}
			>
				Maybe later
			</button>
		</div>
	</div>
</Modal>
