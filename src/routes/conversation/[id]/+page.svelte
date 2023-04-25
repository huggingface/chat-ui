<script lang="ts">
	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { pendingMessage } from "$lib/stores/pendingMessage";
	import { onMount } from "svelte";
	import type { PageData } from "./$types";
	import { page } from "$app/stores";
	import { textGenerationStream } from "@huggingface/inference";
	import { invalidate } from "$app/navigation";
	import { base } from "$app/paths";
	import { PUBLIC_MAX_INPUT_TOKENS } from "$env/static/public";
	import { shareConversation } from "$lib/shareConversation";
	import { UrlDependency } from "$lib/types/UrlDependency";

	export let data: PageData;

	let messages = data.messages;
	let lastLoadedMessages = data.messages;

	// Since we modify the messages array locally, we don't want to reset it if an old version is passed
	$: if (data.messages !== lastLoadedMessages) {
		messages = data.messages;
		lastLoadedMessages = data.messages;
	}

	let loading = false;
	let pending = false;

	async function getTextGenerationStream(inputs: string) {
		let conversationId = $page.params.id;

		const response = textGenerationStream(
			{
				model: $page.url.href,
				inputs,
				parameters: {
					// Taken from https://huggingface.co/spaces/huggingface/open-assistant-private-testing/blob/main/app.py#L54
					temperature: 0.9,
					top_p: 0.95,
					repetition_penalty: 1.2,
					top_k: 50,
					// @ts-ignore
					truncate: parseInt(PUBLIC_MAX_INPUT_TOKENS),
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

			// final message
			if (data.generated_text) {
				const lastMessage = messages.at(-1);
				if (lastMessage) {
					lastMessage.content = data.generated_text;
					messages = [...messages];
				}
				break;
			}

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
		await fetch(`${base}/conversation/${id}/summarize`, {
			method: "POST",
		});
	}

	async function writeMessage(message: string) {
		if (!message.trim()) return;

		try {
			loading = true;
			pending = true;

			messages = [...messages, { from: "user", content: message }];

			await getTextGenerationStream(message);

			if (messages.filter((m) => m.from === "user").length === 1) {
				summarizeTitle($page.params.id)
					.then(() => invalidate(UrlDependency.ConversationList))
					.catch(console.error);
			} else {
				await invalidate(UrlDependency.ConversationList);
			}
		} catch (err) {
			console.error(err);
			alert(String(err));
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

<ChatWindow
	{loading}
	{pending}
	{messages}
	on:message={(message) => writeMessage(message.detail)}
	on:share={() => shareConversation($page.params.id, data.title)}
/>
