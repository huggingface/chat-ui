<script lang="ts">
	import type { PageData, ActionData } from "./$types";
	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head
	><title>Connect Slack to HuggingChat</title><meta
		name="referrer"
		content="same-origin"
	/></svelte:head
>
<div class="mx-auto max-w-xl space-y-5 p-8">
	<h1 class="text-2xl font-semibold">ML Intern in Slack</h1>
	<p>Hugging Face account: <strong>{data.username}</strong></p>
	{#if form && "error" in form}<p role="alert">{form.error}</p>{/if}
	{#if form && "disconnected" in form}
		<p>
			Disconnected. New Slack requests and automatic continuations cannot use this connection. Jobs
			already submitted keep running until cancelled or timed out.
		</p>
	{:else if data.ticket}
		<p>
			Connect this account to Slack user {data.slackUser} in workspace {data.slackTeam}. Only
			continue if you requested it yourself.
		</p>
		<p>
			New sessions you start will appear in your HuggingChat history and use your HF permissions and
			current billing settings. Inference may incur charges; compute jobs still require an explicit
			session budget.
		</p>
		<p>
			People in your Slack thread can contribute requests using that session's approved budget. Your
			private HuggingChat conversation is accessible only to you unless you share it. Its contents
			are available read-only in the browser. Continue the session and approve budgets in Slack.
		</p>
		<p>
			The connection uses your current HuggingChat login. If it expires or is revoked, reconnect
			here. Connecting another HF account does not transfer existing sessions.
		</p>
		<form method="POST">
			<input type="hidden" name="ticket" value={data.ticket} />
			<button class="rounded bg-black px-4 py-2 text-white" type="submit"
				>Connect Hugging Face</button
			>
		</form>
	{:else if data.connected}
		<p>
			Your account is connected. Return to Slack and mention ML Intern again to start your request.
		</p>
		<form method="POST">
			<button class="rounded border px-4 py-2" name="action" value="disconnect"
				>Disconnect Slack</button
			>
		</form>
	{:else}
		<p>Mention ML Intern in Slack to receive a private connection link.</p>
	{/if}
</div>
