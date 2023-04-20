<script lang="ts">
	import '../styles/main.css';
	import type { LayoutData } from './$types';

	export let data: LayoutData;

	function switchTheme() {
		const { classList } = document.querySelector('html') as HTMLElement;
		if (classList.contains('dark')) {
			classList.remove('dark');
			localStorage.theme = 'light';
		} else {
			classList.add('dark');
			localStorage.theme = 'dark';
		}
	}

	async function shareConversation(id: string, title: string) {
		try {
			const res = await fetch(`/conversation/${id}/share`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				}
			});

			if (!res.ok) {
				alert('Error while sharing conversation: ' + (await res.text()));
				return;
			}

			const { url } = await res.json();

			if (navigator.share) {
				navigator.share({
					title,
					text: 'Share this chat with others',
					url
				});
			} else {
				prompt('Share this link with your friends:', url);
			}
		} catch (err) {
			console.error(err);
			alert('Error while sharing conversation: ' + err);
		}
	}
</script>

<div
	class="grid h-screen w-screen md:grid-cols-[280px,1fr] overflow-hidden text-smd dark:text-gray-300"
>
	<nav
		class="max-md:hidden grid grid-rows-[auto,1fr,auto] grid-cols-1 max-h-screen bg-gradient-to-l from-gray-50 dark:from-gray-800/30 rounded-r-xl"
	>
		<div class="flex-none sticky top-0 p-3 flex flex-col">
			<a
				href="/"
				class="border px-12 py-2.5 rounded-lg shadow bg-white dark:bg-gray-700 dark:border-gray-600"
			>
				New Chat
			</a>
		</div>
		<div class="flex flex-col overflow-y-auto p-3 -mt-3 gap-2">
			{#each data.conversations as conv}
				<a
					href="/conversation/{conv.id}"
					class="truncate py-3 px-3 rounded-lg flex-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex justify-between items-center"
				>
					{conv.title}

					<button
						class="bg-white rounded border-black px-2 py-1 border-[1px] border-solid"
						on:click|preventDefault={() => shareConversation(conv.id, conv.title)}
					>
						Share
					</button>
				</a>
			{/each}
		</div>
		<div class="flex flex-col p-3 gap-2">
			<button
				on:click={switchTheme}
				class="text-left flex items-center first-letter:capitalize truncate py-3 px-3 rounded-lg flex-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
			>
				Theme
			</button>
			<a
				href="/"
				class="truncate py-3 px-3 rounded-lg flex-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
			>
				Settings
			</a>
		</div>
	</nav>
	<slot />
</div>
