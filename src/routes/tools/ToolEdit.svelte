<script lang="ts">
	import type { CommunityToolEditable } from "$lib/types/Tool";
	import { onMount } from "svelte";
	import type { Client } from "@gradio/client";
	import { browser } from "$app/environment";
	import ToolLogo from "$lib/components/ToolLogo.svelte";
	import { colors, icons } from "$lib/utils/tools";

	type ActionData = {
		error: boolean;
		errors: {
			field: string | number;
			message: string;
		}[];
	} | null;

	export let tool: CommunityToolEditable | undefined = undefined;
	export let form: ActionData;

	function getError(field: string, returnForm: ActionData) {
		return returnForm?.errors.find((error) => error.field === field)?.message ?? "";
	}

	let ClientCreator: { connect: (nameSpace: string) => Promise<Client> };
	onMount(async () => {
		ClientCreator = (await import("@gradio/client")).Client;
	});

	let spaceUrl = tool?.baseUrl ?? "multimodalart/cosxl";
	let icon = tool?.icon ?? "wikis";
	let color = tool?.color ?? "blue";
	let endpointName = tool?.endpoint ?? "";
	let inputs: CommunityToolEditable["inputs"] = tool?.inputs ?? [];

	$: if (endpointName !== tool?.endpoint) {
		inputs = [];
	}
	$: client = browser && !!spaceUrl && !!ClientCreator && ClientCreator.connect(spaceUrl);
</script>

<form method="POST" class="relative flex h-full flex-col overflow-y-auto p-4 md:p-8">
	{#if tool}
		<h2 class="text-xl font-semibold">
			Edit Tool: {tool.displayName}
		</h2>
		<p class="mb-6 text-sm text-gray-500">
			Modifying an existing tool will propagate the changes to all users.
		</p>
	{:else}
		<h2 class="text-xl font-semibold">Create new tool</h2>
		<p class="mb-6 text-sm text-gray-500">
			Create and share your own tools. All tools are <span
				class="rounded-full border px-2 py-0.5 leading-none">public</span
			>
		</p>
	{/if}

	<div class="grid h-full w-full flex-1 grid-cols-2 gap-6 text-sm max-sm:grid-cols-1">
		<div class="col-span-1 flex flex-col gap-4">
			<div class="flex flex-col gap-4">
				<label>
					<div class="mb-1 font-semibold">Tool Display Name</div>
					<input
						type="text"
						name="displayName"
						class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
						placeholder="Image generator"
						value={tool?.displayName ?? ""}
					/>
					<p class="text-xs text-red-500">{getError("displayName", form)}</p>
				</label>

				<div class="flex flex-row gap-4">
					<div>
						{#key color + icon}
							<ToolLogo {color} {icon} />
						{/key}
					</div>

					<label class="flex-grow">
						<div class="mb-1 font-semibold">Icon</div>

						<select
							name="icon"
							class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
							bind:value={icon}
						>
							{#each icons as icon}
								<option value={icon}>{icon}</option>
							{/each}
							<p class="text-xs text-red-500">{getError("icon", form)}</p>
						</select>
					</label>

					<label class="flex-grow">
						<div class="mb-1 font-semibold">Color scheme</div>
						<select
							name="color"
							class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
							bind:value={color}
						>
							{#each colors as color}
								<option value={color}>{color}</option>
							{/each}
							<p class="text-xs text-red-500">{getError("color", form)}</p>
						</select>
					</label>
				</div>
				<label>
					<div class="mb-1 font-semibold">Hugging Face Space URL</div>
					<input
						type="text"
						name="spaceUrl"
						class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
						placeholder="ByteDance/Hyper-SDXL-1Step-T2I"
						bind:value={spaceUrl}
					/>
					<p class="text-xs text-red-500">{getError("spaceUrl", form)}</p>
				</label>
				<p class="text-justify text-gray-800">
					Tools allows models that support them to use external application directly via function
					calling. Tools must use Hugging Face Gradio Spaces as we detect the input and output types
					automatically from the <a
						class="underline"
						href="https://www.gradio.app/guides/sharing-your-app#api-page">Gradio API</a
					>. For GPU intensive tool consider using a ZeroGPU Space.
				</p>
			</div>
		</div>
		<div class="col-span-1 flex flex-col gap-4">
			<div class="flex flex-col gap-2">
				<h3 class="mb-1 font-semibold">Functions</h3>
				<p class="text-sm text-gray-500">Choose functions that can be called in your tool.</p>
				{#if client}
					{#await client.then((c) => c.view_api())}
						<p class="text-sm text-gray-500">Loading...</p>
					{:then api}
						<div class="flex flex-row gap-4">
							{#each Object.keys(api["named_endpoints"] ?? {}) as name}
								<label>
									<input type="radio" bind:group={endpointName} value={name} {name} />
									<span class="font-mono text-gray-800" class:font-semibold={endpointName === name}
										>{name}</span
									>
								</label>
							{/each}
						</div>

						{#if endpointName && api["named_endpoints"][endpointName]}
							<!-- grab endpoint from api["named_endpoints"] which is record<string, object> by matching the key to Endpoint name -->
							{@const endpoint = api["named_endpoints"][endpointName]}
							<div class="flex flex-col gap-2">
								<div class="flex flex-col gap-2 border border-gray-200 p-2">
									<div class="flex items-center gap-1 border-b border-gray-200 p-1 pb-2">
										<span class="flex-grow font-mono text-smd font-semibold">{endpointName}</span>

										<label class="ml-auto">
											<span class="text-sm text-gray-500">AI Name</span>
											<input
												class="h-fit rounded-lg border-2 border-gray-200 bg-gray-100 p-1"
												type="text"
												value={endpointName.replace(/\//g, "")}
											/>
										</label>
									</div>

									<div>
										<h3 class="font-semibold">Arguments</h3>
										<p class="mb-2 text-sm text-gray-500">
											Choose parameters that can be passed to your tool.
										</p>
									</div>

									{#each endpoint.parameters as parameter}
										{@const input = inputs.find((input) => input.name === parameter.parameter_name)}
										<div class="flex items-center gap-1">
											<div class="inline w-full">
												<span class="font-mono text-sm">{parameter.parameter_name}</span>
												<span
													class="inline-block rounded-lg bg-orange-50 p-1 text-sm text-orange-800"
													>{parameter.python_type.type}</span
												>
												{#if parameter.description}
													<p class="text-sm text-gray-500">{parameter.description}</p>
												{/if}
												<div class="flex w-fit justify-start gap-2">
													<label class="ml-auto">
														<input
															type="radio"
															name="{parameter.parameter_name}-parameter-type"
															value="required"
														/>
														<span class="text-sm text-gray-500">Required</span>
													</label>
													<label class="ml-auto">
														<input
															type="radio"
															name="{parameter.parameter_name}-parameter-type"
															value="optional"
														/>
														<span class="text-sm text-gray-500">Optional</span>
													</label>
													<label class="ml-auto">
														<input
															type="radio"
															name="{parameter.parameter_name}-parameter-type"
															value="fixed"
														/>
														<span class="text-sm text-gray-500">Fixed</span>
													</label>
												</div>
											</div>
											<input
												class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
												type="text"
												value={input?.default
													? input.default
													: parameter.parameter_has_default
													? parameter.parameter_default
													: parameter.example_input}
											/>
										</div>
									{/each}

									<div>
										<h3 class="font-semibold">Return value</h3>
										<p class="mb-2 text-sm text-gray-500">
											Choose what value your tool will use as return value
										</p>
									</div>
								</div>
							</div>
						{/if}
					{:catch error}
						<p class="text-sm text-gray-500">{error}</p>
					{/await}
				{/if}
			</div>
		</div>
	</div>
</form>
