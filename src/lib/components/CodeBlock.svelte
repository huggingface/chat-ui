<script lang="ts">
	export let code: string = '';
	export let lang: string = '';
</script>

<div>
	<button
		class="absolute top-0 right-0 bg-gray-100 dark:bg-gray-800 rounded-full p-1.5"
		on:click={() => {
			navigator.clipboard.writeText(code);
		}}
	>
		<svg
			class="w-4 h-4 text-gray-500 dark:text-gray-400"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M8 9l4-4 4 4m0 6l-4 4-4-4"
			/>
		</svg>
	</button>
	<div class="relative">
		<pre class="rounded-2xl px-5 py-3.5 text-gray-500 dark:text-gray-400">
            <code class="language-${lang}">${code}</code>
        </pre>
	</div>
</div>
