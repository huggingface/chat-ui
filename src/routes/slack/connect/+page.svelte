<script lang="ts">
	import type { PageData, ActionData } from "./$types";
	let { data, form }: { data: PageData; form: ActionData } = $props();
	const mcpSyncNote =
		"Their settings, including API keys you added, are stored encrypted for Slack, and information those tools return may be posted in the Slack thread.";
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
			Connect this account to Slack user {data.slackNames?.displayName} ({data.slackUser}) in
			workspace {data.slackNames?.workspaceName} ({data.slackTeam}). Your Slack account belongs to
			workspace {data.slackUserTeam}. Only continue if you requested it yourself.
		</p>
		<p>
			New sessions you start will appear in your HuggingChat history and use your HF permissions and
			current billing settings. Inference may incur charges; compute jobs still require an explicit
			session budget.
		</p>
		<p>
			Only you can issue requests in your personal Slack sessions. Your full HF permissions and
			inference billing apply, not just the Jobs budget. Your private HuggingChat conversation is
			accessible only to you unless you share it. The bot can read other participants’ messages and
			attachments as context. Its public replies and results are visible to everyone in the Slack
			channel, including external organizations in Slack Connect. Its contents are available
			read-only in the browser. Continue the session and approve budgets in Slack.
		</p>
		<p>
			The connection uses your current HuggingChat login. If it expires or is revoked, reconnect
			here. Connecting another HF account does not transfer existing sessions.
		</p>
		<form method="POST">
			<input type="hidden" name="ticket" value={data.ticket} />
			{#if data.mcpSyncAvailable}
				<label class="mb-4 flex items-start gap-2">
					<input type="checkbox" name="useMcpServers" class="mt-1" checked={data.mcpSync} />
					<span>Also use my enabled HuggingChat MCP servers in Slack. {mcpSyncNote}</span>
				</label>
			{/if}
			<button class="rounded bg-black px-4 py-2 text-white" type="submit"
				>Connect Hugging Face</button
			>
		</form>
	{:else if data.connected}
		<p>
			Your account is connected. Return to Slack and mention ML Intern again to start your request.
		</p>
		{#if !data.mcpSyncAvailable}
			<p>
				ML Intern uses only its built-in tools in Slack. Using your HuggingChat MCP servers in Slack
				is not enabled on this server.
			</p>
		{:else}
			<form method="POST" class="space-y-2">
				<input type="hidden" name="action" value="mcp" />
				<input type="hidden" name="enabled" value={data.mcpSync ? "false" : "true"} />
				<p>
					{data.mcpSync
						? "ML Intern uses your enabled HuggingChat MCP servers in your personal Slack sessions. Information returned by those tools may be posted in the Slack thread."
						: `ML Intern uses only its built-in tools in Slack. You can let it use your enabled HuggingChat MCP servers too. ${mcpSyncNote}`}
				</p>
				<button class="rounded border px-4 py-2" type="submit"
					>{data.mcpSync
						? "Stop using my MCP servers in Slack"
						: "Use my MCP servers in Slack"}</button
				>
			</form>
		{/if}
		{#each data.connections as connection}
			<p>
				Slack user {connection.displayName} ({connection.slackUserId}) in workspace {connection.workspaceName}
				({connection.teamId})
			</p>
			<form method="POST">
				<input type="hidden" name="connectionId" value={connection._id} />
				<button class="rounded border px-4 py-2" name="action" value="disconnect"
					>Disconnect this Slack account</button
				>
			</form>
		{/each}
	{:else}
		<p>Mention ML Intern in Slack to receive a private connection link.</p>
	{/if}
</div>
