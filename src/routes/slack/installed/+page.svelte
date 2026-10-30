<script lang="ts">
	import { base } from "$app/paths";
	import type { PageData } from "./$types";
	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>ML Intern for Slack</title></svelte:head>
<div class="mx-auto max-w-xl space-y-5 p-8">
	{#if data.installed}
		<h1 class="text-2xl font-semibold">ML Intern is in {data.installed.teamName}</h1>
		<ol class="list-decimal space-y-2 pl-5">
			<li>
				Add @ML Intern to a channel from its details → Agents & apps, then mention it with a task.
			</li>
			<li>
				The first time, it sends you a private link to connect your Hugging Face account. It works
				with your account, so inference is billed to you, and compute jobs only run on a budget you
				approve.
			</li>
		</ol>
		<p>Everyone in your workspace connects their own account the same way.</p>
		<a class="inline-block rounded bg-black px-4 py-2 text-white" href={data.installed.slackUrl}
			>Open Slack</a
		>
	{:else if data.cancelled}
		<h1 class="text-2xl font-semibold">ML Intern was not installed</h1>
		<p>
			The install was cancelled in Slack. If your workspace needs an admin to approve apps, Slack
			lets you send them a request; once they approve it, open the install link again.
		</p>
		<a class="inline-block rounded border px-4 py-2" href="{base}/slack/install">Try again</a>
	{:else}
		<h1 class="text-2xl font-semibold">ML Intern for Slack</h1>
		<a class="inline-block rounded bg-black px-4 py-2 text-white" href="{base}/slack/install"
			>Add to Slack</a
		>
	{/if}
</div>
