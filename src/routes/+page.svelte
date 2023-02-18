<div class="grid h-screen w-screen md:grid-cols-[256px,1fr] overflow-hidden text-smd">
	<div class="max-md:hidden bg-gray-900/20 pt-12 px-6">
		<button
			class="border px-12 py-2.5 rounded-lg bg-gray-800/20 border border-gray-800/50 shadow w-full"
			>New Chat</button
		>
	</div>
	<div class="overflow-y-auto">
		<div class="max-w-4xl mx-auto px-5 pt-12 flex flex-col gap-8">
			{#each Array(4) as _}
				<div class="flex items-start justify-start gap-4 leading-relaxed">
					<img
						src="https://huggingface.co/avatars/2edb18bd0206c16b433841a47f53fa8e.svg"
						class="mt-5 h-3.5 w-3.5 flex-none rounded-full shadow-lg shadow-white/40"
					/>
					<div
						class="group relative rounded-2xl bg-gradient-to-br from-gray-800/50 to-gray-800/20 px-5 py-3.5"
					>
						Lorem ipsum, dolor sit amet consectetur adipisicing eLorem ipsum, dolor sit amet
						consectetur adipisicing iciis? Lorem ipsum dolor sit amet consectetur adipisicing elit.
						Rem, qui consequatur voluptas inventore recusandae animi voluptate consectetur aperiam,
						sapiente aliqm possimus quasi accusamus, dolores nobis officiis vitae tenetur? Porro,
						corporis.
					</div>
				</div>
				<div class="mb-2 flex items-start justify-start gap-4 text-gray-300/80">
					<div class="mt-4 h-3.5 w-3.5 flex-none rounded-full" />
					<div class="rounded-2xl px-5 py-3.5">
						Lorem ipsum, dolor sit amet consectetur adipisicing eLorem ipsum, dolor sit amet
						consectetur adipisicing eLorem ipsum
					</div>
				</div>
			{/each}
			<div class="h-32" />
		</div>
	</div>
	<div
		class="flex items-center justify-center absolute left-[256px] right-0  px-5 bottom-0 h-32 bg-gradient-to-t from-black to-black/0"
	>
		<div
			class="shadow-alternate relative flex items-center rounded-xl border border-gray-100 dark:bg-gray-950"
		>
			<svg
				class="absolute left-3 text-gray-300 top-1/2 transform -translate-y-1/2 pointer-events-none"
				xmlns="http://www.w3.org/2000/svg"
				xmlns:xlink="http://www.w3.org/1999/xlink"
				aria-hidden="true"
				focusable="false"
				role="img"
				width="1em"
				height="1em"
				preserveAspectRatio="xMidYMid meet"
				viewBox="0 0 32 32"
				><path
					d="M30 28.59L22.45 21A11 11 0 1 0 21 22.45L28.59 30zM5 14a9 9 0 1 1 9 9a9 9 0 0 1-9-9z"
					fill="currentColor"
				/></svg
			>
			<input
				class="flex-1 border-none bg-transparent px-1 py-2 pr-3 pl-10 outline-none placeholder:text-gray-400"
				placeholder="Search anything on the Hub"
			/>
		</div>
		<!-- <input
			type="text"
			placeholder="Type anything..."
			class="w-full rounded-2xl border border-black bg-black px-4 py-3.5 shadow-2xl shadow-white/5 outline-none ring-gray-700 focus:ring-1 max-w-4xl"
		/> -->
	</div>
</div>
