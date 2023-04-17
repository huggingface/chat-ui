<script lang="ts">
	import type { Message, StreamResponse } from '$lib/Types';

	import { afterUpdate } from 'svelte';

	import { fetchEventSource } from '@microsoft/fetch-event-source';

	import ChatMessage from '$lib/components/chat/ChatMessage.svelte';
	import ChatIntroduction from '$lib/components/chat/ChatIntroduction.svelte';
	import ChatInput from '$lib/components/chat/ChatInput.svelte';

	import {
		PUBLIC_ASSISTANT_MESSAGE_TOKEN,
		PUBLIC_ENDPOINT,
		PUBLIC_HF_TOKEN,
		PUBLIC_SEP_TOKEN,
		PUBLIC_USER_MESSAGE_TOKEN
	} from '$env/static/public';

	const userToken = PUBLIC_USER_MESSAGE_TOKEN || '<|prompter|>';
	const assistantToken = PUBLIC_ASSISTANT_MESSAGE_TOKEN || '<|assistant|>';
	const sepToken = PUBLIC_SEP_TOKEN || '<|endoftext|>';

	let messages: Message[] = [];
	let message = '';

	let messagesContainer: HTMLElement;

	afterUpdate(() => {
		messagesContainer.scrollTo(0, messagesContainer.scrollHeight);
	});

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

	function onWrite() {
		if (!message) return;

		messages = [...messages, { from: 'user', content: message }];
		message = '';
		const inputs =
			messages
				.map(
					(m) =>
						(m.from === 'user' ? userToken + m.content : assistantToken + m.content) +
						(m.content.endsWith(sepToken) ? '' : sepToken)
				)
				.join('') + assistantToken;

		console.log(inputs);
		fetchEventSource(PUBLIC_ENDPOINT, {
			method: 'POST',
			headers: {
				Accept: 'text/event-stream',
				'Content-Type': 'application/json',
				'user-agent': 'chat-ui/0.0.1',
				...(PUBLIC_HF_TOKEN
					? {
							authorization: `Bearer ${PUBLIC_HF_TOKEN}`
					  }
					: {})
			},
			body: JSON.stringify({
				inputs: inputs,
				stream: true,
				parameters: {
					do_sample: false,
					max_new_tokens: 500,
					return_full_text: false,
					stop: [],
					truncate: 1000,
					typical_p: 0.2,
					watermark: false,
					details: true
				}
			}),
			async onopen(response) {
				if (response.ok && response.headers.get('content-type') === 'text/event-stream') {
					messages = [...messages, { from: 'bot', content: '' }];
				} else {
					console.error('error opening the SSE endpoint');
				}
			},
			onmessage(msg) {
				const data = JSON.parse(msg.data) as StreamResponse;
				// console.log(data);
				if (!data.token.special) {
					messages.at(-1)!.content += data.token.text;
					messages = messages;
				}
			}
		});
	}
</script>

<div
	class="grid h-screen w-screen md:grid-cols-[280px,1fr] overflow-hidden text-smd dark:text-gray-300"
>
	<nav
		class="max-md:hidden grid grid-rows-[auto,1fr,auto] grid-cols-1 max-h-screen bg-gradient-to-l from-gray-50 dark:from-gray-800/30 rounded-r-xl"
	>
		<div class="flex-none sticky top-0 p-3 flex flex-col">
			<button
				on:click={() => location.reload()}
				class="border px-12 py-2.5 rounded-lg shadow bg-white dark:bg-gray-700 dark:border-gray-600"
				>New Chat</button
			>
		</div>
		<div class="flex flex-col overflow-y-auto p-3 -mt-3 gap-2">
			{#each Array(5) as _}
				<a
					href="/"
					class="truncate py-3 px-3 rounded-lg flex-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
				>
					Amet consectetur adipisicing elit. Eos dolorum nihil alias.
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
	<div class="relative h-screen">
		<nav
			class="sm:hidden flex items-center h-12 border-b px-4 justify-between dark:border-gray-800"
		>
			<button>[ ]</button>
			<button>New Chat</button>
			<button>+</button>
		</nav>
		<div class="overflow-y-auto h-full" bind:this={messagesContainer}>
			<div class="max-w-3xl xl:max-w-4xl mx-auto px-5 pt-6 flex flex-col gap-8 h-full">
				{#each messages as message}
					<ChatMessage {message} />
				{:else}
					<ChatIntroduction />
				{/each}
				<div class="h-32 flex-none" />
			</div>
		</div>
		<div
			class="flex max-md:border-t dark:border-gray-800 items-center max-md:dark:bg-gray-900 max-md:bg-white bg-gradient-to-t from-white dark:from-gray-900 to-transparent justify-center absolute inset-x-0 max-w-3xl xl:max-w-4xl mx-auto px-5 bottom-0 py-4 md:py-8 w-full"
		>
			<form
				on:submit={onWrite}
				class="shadow-alternate relative flex items-center rounded-xl flex-1 max-w-4xl border bg-gray-100 dark:bg-gray-700 dark:border-gray-600"
			>
				<div class="flex flex-1 border-none bg-transparent">
					<ChatInput
						placeholder="Ask anything"
						bind:value={message}
						on:submit={onWrite}
						autofocus
						maxRows={10}
					/>
					<button
						class="p-1 px-[0.7rem] self-end my-1 h-[2.4rem] rounded-lg text-gray-500 hover:bg-gray-100 enabled:dark:hover:text-gray-400 dark:hover:bg-gray-900 disabled:hover:bg-transparent dark:disabled:hover:bg-transparent disabled:opacity-40 mr-1"
					>
						<svg
							class="text-gray-300 pointer-events-none"
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
						></button
					>
				</div>
			</form>
		</div>
	</div>
</div>
