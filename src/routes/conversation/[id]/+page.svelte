<script lang="ts">
	import ChatWindow from '$lib/components/chat/ChatWindow.svelte';
	import { pendingMessage } from '$lib/stores/pendingMessage';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import { page } from '$app/stores';
	import {
		PUBLIC_ASSISTANT_MESSAGE_TOKEN,
		PUBLIC_SEP_TOKEN,
		PUBLIC_USER_MESSAGE_TOKEN
	} from '$env/static/public';
	import { HfInference } from '@huggingface/inference';

	export let data: PageData;

	$: messages = data.messages;

	const userToken = PUBLIC_USER_MESSAGE_TOKEN;
	const assistantToken = PUBLIC_ASSISTANT_MESSAGE_TOKEN;
	const sepToken = PUBLIC_SEP_TOKEN;

	const hf = new HfInference();
	const model = hf.endpoint(`${$page.url.origin}/api/conversation`);

	let loading = false;

	async function getTextGenerationStream(inputs: string) {
		const response = model.textGenerationStream(
			{
				inputs,
				parameters: {
					// Taken from https://huggingface.co/spaces/huggingface/open-assistant-private-testing/blob/main/app.py#L54
					// @ts-ignore
					stop: ['<|endoftext|>'],
					max_new_tokens: 1024,
					truncate: 1024,
					typical_p: 0.2
				}
			},
			{
				use_cache: false
			}
		);

		// Regex to check if the text finishes by "<" but is not a piece of code like "`<img>`"
		const endOfTextRegex = /(?<!`)<(?!`)/;

		for await (const data of response) {
			if (!data) break;

			if (!data.token.special) {
				const lastMessage = messages.at(-1);

				if (lastMessage?.from !== 'assistant') {
					// First token has a space at the beginning, trim it
					messages = [...messages, { from: 'assistant', content: data.token.text.trimStart() }];
				} else {
					const isEndOfText = endOfTextRegex.test(data.token.text);

					lastMessage.content += isEndOfText ? data.token.text.replace('<', '') : data.token.text;
					messages = [...messages];

					if (isEndOfText) break;
				}
			}
		}

		// todo: if everything went well, store message + response in DB
	}

	async function writeMessage(message: string) {
		if (!message.trim()) return;

		try {
			loading = true;

			messages = [...messages, { from: 'user', content: message }];

			const inputs =
				messages
					.map(
						(m) =>
							(m.from === 'user' ? userToken + m.content : assistantToken + m.content) +
							(m.content.endsWith(sepToken) ? '' : sepToken)
					)
					.join('') + assistantToken;

			await getTextGenerationStream(inputs);
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		if ($pendingMessage) {
			const val = $pendingMessage;
			$pendingMessage = '';

			if (messages.length === 0) {
				writeMessage(val);
			}
		}
	});
</script>

<ChatWindow disabled={loading} {messages} on:message={(message) => writeMessage(message.detail)} />
