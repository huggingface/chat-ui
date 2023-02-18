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

	let messages: Message[] = [];
	let message = '';

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

<div class="grid h-screen w-screen md:grid-cols-[256px,1fr] overflow-hidden text-smd">
	<div class="max-md:hidden bg-gray-900/20 pt-6 px-6">
		<button
			class="border px-12 py-2.5 rounded-lg bg-gray-800/20 border border-gray-800/50 shadow w-full"
			>New Chat</button
		>
	</div>
	<div class="overflow-y-auto">
		<div class="max-w-4xl mx-auto px-5 pt-6 flex flex-col gap-8">
			{#each messages as { from, content }}
				{#if from === 'bot'}
					<div class="flex items-start justify-start gap-4 leading-relaxed">
						<img
							src="https://huggingface.co/avatars/2edb18bd0206c16b433841a47f53fa8e.svg"
							class="mt-4 w-3 h-3 flex-none rounded-full shadow-lg shadow-white/40"
						/>
						<div
							class="group relative rounded-2xl bg-gradient-to-br from-gray-800/50 to-gray-800/20 px-5 py-3.5"
						>
							{content}
						</div>
					</div>
				{/if}
				{#if from === 'user'}
					<div class="flex items-start justify-start gap-4 text-gray-300/80">
						<div class="mt-4 w-3 h-3 flex-none rounded-full" />
						<div class="rounded-2xl px-5 py-3.5">
							{content}
						</div>
					</div>
				{/if}
			{/each}
			<div class="h-32" />
		</div>
	</div>
	<div
		class="flex items-center justify-center absolute left-[256px] right-0 px-24 bottom-0 h-32 bg-gradient-to-t from-gray-900/50 to-black/0"
	>
		<form
			on:submit={onWrite}
			class="shadow-alternate relative flex items-center rounded-xl border border-gray-900 bg-black shadow-xl flex-1 max-w-4xl"
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
				class="flex-1 border-none bg-transparent px-1 py-3 pr-3 pl-10 outline-none placeholder:text-gray-400"
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
