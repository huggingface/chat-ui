<script lang="ts">
	import { fetchEventSource } from '@microsoft/fetch-event-source';
	const ENDPOINT = 'https://joi-20b.ngrok.io/generate_stream';

	type Message =
		| {
				from: 'user';
				content: string;
		  }
		| {
				from: 'bot';
				content: string;
		  };

	let messages: Message[] = [
		{
			from: 'user',
			content: 'hello bot'
		},
		{
			from: 'bot',
			content: " Hello! I'm a conversational chatbot. What can I help you with today?<|endoftext|>"
		},
		{
			from: 'user',
			content: 'how are you?'
		},
		{
			from: 'bot',
			content: " I'm fine, thank you for asking. How are you?<|endoftext|>"
		}
	];
	let message = '';

	$: console.log(messages);

	function onWrite() {
		messages = [...messages, { from: 'user', content: message }];
		message = '';
		let incoming = '';
		const inputs =
			messages
				.map((m) => (m.from === 'user' ? `User: ${m.content}\n` : `Joi:${m.content}\n`))
				.join('\n') + '\nJoi:';

		fetchEventSource(ENDPOINT, {
			method: 'POST',
			headers: {
				Accept: 'text/event-stream',
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				inputs: inputs,
				parameters: {
					temperature: 0.5,
					top_p: 0.95,
					do_sample: true,
					max_new_tokens: 512,
					top_k: 4,
					repetition_penalty: 1.03,
					stop: ['User:']
				}
			}),
			async onopen(response) {
				if (response.ok && response.headers.get('content-type') === 'text/event-stream') {
					messages = [...messages, { from: 'bot', content: incoming }];
				} else {
					console.error('error opening the SSE endpoint');
				}
			},
			onmessage(msg) {
				const data = JSON.parse(msg.data);
				// console.log(data);
				messages.at(-1)!.content += data.token.text;
				messages = messages;
			}
		});
	}
</script>

<div class="grid h-screen w-screen md:grid-cols-[280px,1fr] overflow-hidden text-smd">
	<nav class="max-md:hidden  grid grid-rows-[auto,1fr,auto] grid-cols-1 max-h-screen bg-gray-50">
		<div class="flex-none sticky top-0 relative p-3 flex flex-col">
			<button class="border px-12 py-2.5 rounded-lg border shadow bg-white">New Chat</button>
		</div>
		<div class="flex flex-col overflow-y-auto p-3 -mt-3 gap-2">
			{#each Array(5) as _}
				<a href="" class="truncate py-3 px-3 rounded-lg flex-none text-gray-400 hover:bg-gray-100">
					Amet consectetur adipisicing elit. Eos dolorum nihil alias.
				</a>
			{/each}
		</div>
		<div class="flex flex-col p-3 gap-2">
			<a href="" class="truncate  py-3 px-3 rounded-lg mt-auto"> Appearance </a>
			<a href="" class="truncate  py-3 px-3 rounded-lg"> Settings </a>
		</div>
	</nav>
	<div class="overflow-y-auto">
		<div class="max-w-3xl xl:max-w-4xl mx-auto px-5 pt-6 flex flex-col gap-8">
			{#each messages as { from, content }}
				{#if from === 'bot'}
					<div class="flex items-start justify-start gap-4 leading-relaxed">
						<img
							alt=""
							src="https://huggingface.co/avatars/2edb18bd0206c16b433841a47f53fa8e.svg"
							class="mt-5 w-3 h-3 flex-none rounded-full shadow-lg"
						/>
						<div
							class="group relative rounded-2xl px-5 py-3.5 border border-gray-100  bg-gradient-to-br from-gray-50"
						>
							{content}
						</div>
					</div>
				{/if}
				{#if from === 'user'}
					<div class="flex items-start justify-start gap-4">
						<div class="mt-5 w-3 h-3 flex-none rounded-full" />
						<div class="rounded-2xl px-5 py-3.5 text-gray-500">
							{content}
						</div>
					</div>
				{/if}
			{/each}
			<div class="h-32" />
		</div>
	</div>
	<div
		class="flex items-center justify-center absolute left-0 md:left-[280px] right-0 px-8 md:px-24 bottom-0 h-32"
	>
		<form
			on:submit={onWrite}
			class="shadow-alternate relative flex items-center rounded-xl flex-1 max-w-4xl mx-4 border bg-gray-100"
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
				class="flex-1 border-none bg-transparent px-1 py-3 pr-3 pl-10 outline-none"
				bind:value={message}
				on:submit={onWrite}
				placeholder="Ask anything"
				autofocus
			/>
		</form>
		<!-- <input
			type="text"
			placeholder="Type anything..."
			class="w-full rounded-2xl border border-black bg-black px-4 py-3.5 shadow-2xl shadow-white/5 outline-none ring-gray-700 focus:ring-1 max-w-4xl"
		/> -->
	</div>
</div>
