<script lang="ts">
	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { pendingMessage } from "$lib/stores/pendingMessage";
	import { onMount } from "svelte";
	import type { PageData } from "./$types";
	import { page } from "$app/stores";
	import { HfInference } from "@huggingface/inference";
	import { invalidate } from "$app/navigation";
	import { base } from "$app/paths";

	export let data: PageData;

	$: messages = data.messages;

	const hf = new HfInference();

	let conversationId = $page.params.id;
	let loading = false;
	let pending = false;

	async function getTextGenerationStream(inputs: string) {
		const response = hf.endpoint($page.url.href).textGenerationStream(
			{
				inputs,
				parameters: {
					// Taken from https://huggingface.co/spaces/huggingface/open-assistant-private-testing/blob/main/app.py#L54
					temperature: 0.9,
					top_p: 0.95,
					repetition_penalty: 1.2,
					top_k: 50,
					// @ts-ignore
					truncate: 1024,
					watermark: false,
					max_new_tokens: 1024,
					stop: ["<|endoftext|>"],
					return_full_text: false,
				},
			},
			{
				use_cache: false,
			}
		);

		for await (const data of response) {
			pending = false;

			if (!data || conversationId !== $page.params.id) break;

			if (!data.token.special) {
				const lastMessage = messages.at(-1);

				if (lastMessage?.from !== "assistant") {
					// First token has a space at the beginning, trim it
					messages = [...messages, { from: "assistant", content: data.token.text.trimStart() }];
				} else {
					lastMessage.content += data.token.text;
					messages = [...messages];
				}
			}
		}
	}

	async function summarizeTitle(id: string) {
		const response = await fetch(`${base}/conversation/${id}/summarize`, {
			method: "POST",
		});
		if (response.ok) {
			/// TODO(actually invalidate)
			await invalidate("/");
			await invalidate((url) => url.pathname === "/" || url.pathname === base);
			location.reload();
		}
	}

	async function writeMessage(message: string) {
		if (!message.trim()) return;

		try {
			loading = true;
			pending = true;

			messages = [...messages, { from: "user", content: message }];

			await getTextGenerationStream(message);

			if (messages.filter((m) => m.from === "user").length === 1) {
				summarizeTitle($page.params.id).catch(console.error);
			}

			// Reload conversation order - doesn't seem to work
			// await invalidate('/');
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		if ($pendingMessage) {
			const val = $pendingMessage;
			$pendingMessage = "";

			writeMessage(val);
		}
	});
</script>

<ChatWindow {loading} {pending} {messages} on:message={(message) => writeMessage(message.detail)} />
