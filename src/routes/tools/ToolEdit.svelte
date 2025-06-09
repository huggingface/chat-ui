<script lang="ts">
	import {
		ToolOutputComponents,
		type CommunityToolEditable,
		type ToolInput,
	} from "$lib/types/Tool";
	import { createEventDispatcher, onMount } from "svelte";
	import { browser } from "$app/environment";
	import ToolLogo from "$lib/components/ToolLogo.svelte";
	import { colors, icons } from "$lib/utils/tools";
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import ToolInputComponent from "./ToolInputComponent.svelte";
	import { error as errorStore } from "$lib/stores/errors";

	import CarbonInformation from "~icons/carbon/information";
	import { page } from "$app/state";
	import { handleResponse, useAPIClient } from "$lib/APIClient";

	interface Props {
		tool?: CommunityToolEditable | undefined;
		readonly?: boolean;
	}

	let errors = $state<{ field: string; message: string }[]>([]);
	let { tool = undefined, readonly = false }: Props = $props();

	function getError(field: string) {
		return errors.find((error) => error.field === field)?.message ?? "";
	}

	let APIloading = $state(false);
	let formLoading = $state(false);

	const client = useAPIClient();

	const dispatch = createEventDispatcher<{ close: void }>();

	onMount(async () => {
		await updateConfig();
	});

	let spaceUrl = $state(tool?.baseUrl ?? "");

	let editableTool: CommunityToolEditable = $state(
		tool ?? {
			displayName: "",
			description: "",
			// random color & icon for new tools
			color: colors[Math.floor(Math.random() * colors.length)],
			icon: icons[Math.floor(Math.random() * icons.length)],
			baseUrl: "",
			endpoint: "",
			name: "",
			inputs: [],
			outputComponent: null,
			outputComponentIdx: 0,
			showOutput: true,
		}
	);

	$effect(() => {
		editableTool.baseUrl && (spaceUrl = editableTool.baseUrl);
	});

	async function updateConfig() {
		if (!browser || !editableTool.baseUrl || !editableTool.endpoint) {
			return;
		}

		APIloading = true;

		const api = await client["spaces-config"]
			.get({
				query: {
					space: editableTool.baseUrl,
				},
			})
			.then(handleResponse);

		const newInputs = api.named_endpoints[editableTool.endpoint].parameters.map((param, idx) => {
			if (tool?.inputs[idx]?.name === param.parameter_name) {
				// if the tool has the same name, we use the tool's type
				return {
					...tool?.inputs[idx],
				} satisfies ToolInput;
			}

			const type = parseValidInputType(param.python_type.type);

			if (param.parameter_has_default && param.python_type.type !== "filepath") {
				// optional if it has a default
				return {
					name: param.parameter_name,
					description: param.description,
					paramType: "optional" as const,
					default: param.parameter_default,
					...(type === "file" ? { mimeTypes: "*/*", type } : { type }),
				};
			} else {
				// required if it doesn't have a default
				return {
					name: param.parameter_name,
					description: param.description,
					paramType: "required" as const,
					...(type === "file" ? { mimeTypes: "*/*", type } : { type }),
				};
			}
		});

		editableTool.inputs = newInputs;

		// outout components
		const parsedOutputComponent = ToolOutputComponents.safeParse(
			api.named_endpoints[editableTool.endpoint].returns?.[0]?.component ?? null
		);

		if (parsedOutputComponent.success) {
			editableTool.outputComponent = "0;" + parsedOutputComponent.data;
		} else {
			errors = [
				{
					field: "outputComponent",
					message: `Invalid output component. Type ${
						api.named_endpoints[editableTool.endpoint].returns?.[0]?.component
					} is not yet supported. Feel free to report this issue so we can add support for it.`,
				},
			];
			editableTool.outputComponent = null;
		}

		APIloading = false;
	}

	async function onEndpointChange(e: Event) {
		const target = e.target as HTMLInputElement;
		editableTool.endpoint = target.value;
		editableTool.name = target.value.replace(/\//g, "");

		await updateConfig();
	}

	function parseValidInputType(type: string) {
		switch (type) {
			case "str":
			case "int":
			case "float":
			case "bool":
				return type;
			case "filepath":
				return "file" as const;
			default:
				return "str";
		}
	}

	let formSubmittable = $derived(
		editableTool.name && editableTool.baseUrl && editableTool.outputComponent
	);
</script>

<form
	class="relative flex h-full flex-col overflow-y-auto p-4 md:p-8"
	onsubmit={async (e) => {
		e.preventDefault();
		formLoading = true;
		errors = [];

		try {
			const body = JSON.stringify(editableTool);
			let response: Response;

			if (page.params.toolId) {
				response = await fetch(`${base}/api/tools/${page.params.toolId}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body,
				});
			} else {
				response = await fetch(`${base}/api/tools`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body,
				});
			}

			if (response.ok) {
				const { toolId } = await response.json();
				goto(`${base}/tools/${toolId}`, { invalidateAll: true });
			} else if (response.status === 400) {
				const data = await response.json();
				errors = data.errors;
			} else {
				$errorStore = response.statusText;
			}
		} catch (e) {
			$errorStore = (e as Error).message;
		} finally {
			formLoading = false;
		}
	}}
>
	{#if tool}
		<h2 class="text-xl font-semibold">
			{readonly ? "View" : "Edit"} Tool: {tool.displayName}
		</h2>
		{#if !readonly}
			<p class="mb-6 text-sm text-gray-500">
				Modifying an existing tool will propagate the changes to all users.
			</p>
		{/if}
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
						disabled={readonly}
						class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
						placeholder="Image generator"
						bind:value={editableTool.displayName}
					/>
					<p class="text-xs text-red-500">{getError("displayName")}</p>
				</label>

				<div class="flex flex-row gap-4">
					<div>
						{#key editableTool.color + editableTool.icon}
							<ToolLogo color={editableTool.color} icon={editableTool.icon} />
						{/key}
					</div>

					<label class="flex-grow">
						<div class="mb-1 font-semibold">Icon</div>

						<select
							name="icon"
							disabled={readonly}
							class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
							bind:value={editableTool.icon}
						>
							{#each icons as icon}
								<option value={icon}>{icon}</option>
							{/each}
						</select>
						<p class="text-xs text-red-500">{getError("icon")}</p>
					</label>

					<label class="flex-grow">
						<div class="mb-1 font-semibold">Color scheme</div>
						<select
							name="color"
							disabled={readonly}
							class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
							bind:value={editableTool.color}
						>
							{#each colors as color}
								<option value={color}>{color}</option>
							{/each}
						</select>
						<p class="text-xs text-red-500">{getError("color")}</p>
					</label>
				</div>

				<label>
					<div class=" font-semibold">Tool Description</div>
					<p class="mb-1 text-sm text-gray-500">
						This description will be passed to the model when picking tools. Describe what your tool
						does and when it is appropriate to use.
					</p>
					<textarea
						name="description"
						disabled={readonly}
						class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
						placeholder="This tool lets you generate images using SDXL."
						bind:value={editableTool.description}
					></textarea>
					<p class="text-xs text-red-500">{getError("description")}</p>
				</label>

				<label>
					<div class="mb-1 font-semibold">Hugging Face Space URL</div>
					<p class="mb-1 text-sm text-gray-500">
						Specify the Hugging Face Space where your tool is hosted. <a
							href="https://huggingface.co/spaces"
							target="_blank"
							class="underline">See trending spaces here</a
						>.
					</p>
					<input
						type="text"
						name="spaceUrl"
						disabled={readonly}
						class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
						placeholder="ByteDance/Hyper-SDXL-1Step-T2I"
						bind:value={editableTool.baseUrl}
					/>
					<p class="text-xs text-red-500">{getError("spaceUrl")}</p>
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
				{#if editableTool.baseUrl}
					<p class="text-sm text-gray-500">Choose functions that can be called in your tool.</p>
				{:else}
					<p class="text-sm text-gray-500">Start by specifying a Hugging Face Space URL.</p>
				{/if}

				{#if editableTool.baseUrl}
					{#await client["spaces-config"].get({ query: { space: spaceUrl } }).then(handleResponse)}
						<p class="text-sm text-gray-500">Loading...</p>
					{:then api}
						<div class="flex flex-row flex-wrap gap-4">
							{#each Object.keys(api["named_endpoints"] ?? {}) as name}
								<label class="rounded-lg bg-gray-200 p-2">
									<input
										type="radio"
										disabled={readonly}
										oninput={onEndpointChange}
										bind:group={editableTool.endpoint}
										value={name}
										name="endpoint"
									/>
									<span
										class="font-mono text-gray-800"
										class:font-semibold={editableTool.endpoint === name}>{name}</span
									>
								</label>
							{/each}
						</div>

						{#if editableTool.endpoint && api["named_endpoints"][editableTool.endpoint] && !APIloading}
							{@const endpoint = api["named_endpoints"][editableTool.endpoint]}
							<div class="flex flex-col gap-2">
								<div class="flex flex-col gap-2 rounded-lg border border-gray-200 p-2">
									<div class="flex items-center gap-1 border-b border-gray-200 p-1 pb-2">
										<span class="flex-grow font-mono text-smd font-semibold"
											>{editableTool.endpoint}</span
										>

										<label class="ml-auto">
											<span
												class="group relative flex w-max items-center justify-center text-sm font-semibold text-gray-700"
											>
												AI Function Name
												<CarbonInformation class="m-1 align-middle text-xs text-purple-500" />
												<div
													class="pointer-events-none absolute -top-16 right-0 w-max rounded-md bg-gray-100 p-2 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-gray-800"
												>
													<p class="max-w-sm text-sm font-normal text-gray-800 dark:text-gray-200">
														This is the function name that will be used when prompting the model.
														Make sure it describes your tool well, is short and unique.
													</p>
												</div>
											</span>
											<input
												class="h-fit rounded-lg border-2 border-gray-200 bg-gray-100 p-1"
												type="text"
												name="name"
												disabled={readonly}
												bind:value={editableTool.name}
											/>
										</label>
									</div>

									<div>
										<h3 class="text-lg font-semibold">Arguments</h3>
										<p class="mb-2 text-sm text-gray-500">
											Choose parameters that can be passed to your tool.
										</p>
									</div>

									<p class="text-xs text-red-500">
										{getError("inputs")}
									</p>

									{#each editableTool.inputs as input, inputIdx}
										{@const parameter = endpoint.parameters.find(
											(parameter) => parameter.parameter_name === input.name
										)}

										<div class="flex items-center gap-1">
											<div class="inline w-full">
												<span class="font-mono text-sm">{input.name}</span>
												<span
													class="inline-block max-w-lg truncate rounded-lg bg-orange-50 p-1 text-sm text-orange-800"
													>{parameter?.python_type.type}</span
												>
												{#if parameter?.description}
													<p class="text-sm text-gray-500">
														{parameter.description}
													</p>
												{/if}
												<div class="flex w-fit justify-start gap-2">
													<label class="ml-auto">
														<input
															type="radio"
															name="{input.name}-parameter-type"
															value="required"
															disabled={readonly}
															bind:group={editableTool.inputs[inputIdx].paramType}
														/>
														<span class="text-sm text-gray-500">Required</span>
													</label>
													<label class="ml-auto">
														<input
															type="radio"
															name="{input.name}-parameter-type"
															value="optional"
															disabled={readonly || parameter?.python_type.type === "filepath"}
															bind:group={editableTool.inputs[inputIdx].paramType}
														/>
														<span class="text-sm text-gray-500">Optional</span>
													</label>
													<label class="ml-auto">
														<input
															type="radio"
															name="{input.name}-parameter-type"
															value="fixed"
															disabled={readonly || parameter?.python_type.type === "filepath"}
															bind:group={editableTool.inputs[inputIdx].paramType}
														/>
														<span class="text-sm text-gray-500">Fixed</span>
													</label>
												</div>
											</div>
										</div>
										<!-- for required we need a description, for optional we need a default value and for fixed we need a value -->
										{#if input.paramType === "required" || input.paramType === "optional"}
											<label class="flex flex-row gap-2">
												<div class="mb-1 font-semibold">
													Description
													<p class="text-xs font-normal text-gray-500">
														Will be passed in the model prompt, make it as clear and concise as
														possible
													</p>
												</div>
												<textarea
													name="{input.name}-description"
													class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
													placeholder="This is the description of the input."
													bind:value={input.description}
													disabled={readonly}
												></textarea>
											</label>
										{/if}
										{#if input.paramType === "optional" || input.paramType === "fixed"}
											{@const isOptional = input.paramType === "optional"}
											<div class="flex flex-row gap-2">
												<div class="mb-1 flex-grow font-semibold">
													{isOptional ? "Default value" : "Value"}
													<p class="text-xs font-normal text-gray-500">
														{#if isOptional}
															The tool will use this value by default but the model can specify a
															different one.
														{:else}
															The tool will use this value and it cannot be changed.
														{/if}
													</p>
												</div>
												{#if input.paramType === "optional"}
													<ToolInputComponent
														type={parameter?.python_type.type ?? "str"}
														disabled={readonly}
														bind:value={input.default}
													/>
												{:else}
													<ToolInputComponent
														type={parameter?.python_type.type ?? "str"}
														disabled={readonly}
														bind:value={input.value}
													/>
												{/if}
											</div>
										{/if}
										{#if input.type === "file"}
											<label class="flex flex-row gap-2">
												<div class="mb-1 font-semibold">
													MIME types
													<p class="text-xs font-normal text-gray-500">
														This input is a file. Specify the MIME types that are allowed to be
														passed to the tool.
													</p>
												</div>
												<select
													name="{input.name}-mimeTypes"
													class="h-fit w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
													bind:value={input.mimeTypes}
													disabled={readonly}
												>
													<option value="image/*">image/*</option>
													<option value="audio/*">audio/*</option>
													<option value="video/*">video/*</option>
													<option value="application/pdf">application/pdf</option>
													<option value="text/csv">text/csv</option>
													<option value="*/*">*/*</option>
												</select></label
											>
										{/if}
										<!-- divider -->
										<div
											class="flex w-full flex-row flex-nowrap gap-2 border-b border-gray-200 pt-2"
										></div>
									{/each}

									<div class="flex flex-col gap-4">
										<div>
											<h3 class="text-lg font-semibold">Output options</h3>
											<p class="mb-2 text-sm text-gray-500">
												Choose what value your tool will return and how
											</p>
										</div>

										<label class="flex flex-col gap-2" for="showOutput">
											<div class="mb-1 font-semibold">
												Output component
												<p class="text-xs font-normal text-gray-500">
													Pick the gradio output component whose output will be used in the tool.
												</p>
											</div>
											{#if editableTool.outputComponent}
												{#if api.named_endpoints[editableTool.endpoint].returns.length > 1}
													<div class="flex flex-row gap-4">
														{#each api.named_endpoints[editableTool.endpoint].returns as { component }, idx}
															<label class="text-gray-800">
																<input
																	type="radio"
																	disabled={readonly ||
																		!ToolOutputComponents.safeParse(component).success}
																	bind:group={editableTool.outputComponent}
																	value={idx + ";" + component.toLowerCase()}
																	name="outputComponent"
																/>
																<span
																	class="font-mono"
																	class:text-gray-400={!ToolOutputComponents.safeParse(component)
																		.success}
																	class:font-semibold={editableTool?.outputComponent?.split(
																		";"
																	)[1] === component}>{component.toLowerCase()}-{idx}</span
																>
															</label>
														{/each}
													</div>
												{:else}
													<div>
														<input disabled checked type="radio" />
														<span class="font-mono text-gray-800"
															>{editableTool.outputComponent.split(";")[1]}</span
														>
													</div>
												{/if}
											{/if}
											<p class="text-xs text-red-500">
												{getError("outputComponent")}
											</p>
										</label>

										<label class="flex flex-row gap-2" for="showOutput">
											<div class="mb-1 font-semibold">
												Show output to user directly
												<p class="text-xs font-normal text-gray-500">
													Some tools return long context that should not be shown to the user
													directly.
												</p>
											</div>
											<input
												type="checkbox"
												name="showOutput"
												bind:checked={editableTool.showOutput}
												class="peer rounded-lg border-2 border-gray-200 bg-gray-100 p-1"
											/>
											<p class="text-xs text-red-500">
												{getError("showOutput")}
											</p>
										</label>
									</div>
								</div>
							</div>
						{:else if APIloading}
							<p class="text-sm text-gray-500">Loading API...</p>
						{:else if !api["named_endpoints"]}
							<p class="font-medium text-red-800">
								No endpoints found in this space. Try another one.
							</p>
						{/if}
					{:catch rejected}
						<p class="text-sm text-gray-500">{JSON.parse(rejected.message).value}</p>
					{/await}
				{/if}
			</div>
			<div class="relative bottom-0 mb-4 mt-auto flex w-full flex-row justify-end gap-2">
				<button
					type="button"
					class="mt-4 w-fit rounded-full bg-gray-200 px-4 py-2 font-semibold text-gray-700"
					onclick={() => dispatch("close")}
				>
					Cancel
				</button>
				{#if !readonly}
					<button
						type="submit"
						disabled={formLoading || !formSubmittable}
						class="mt-4 w-fit rounded-full bg-black px-4 py-2 font-semibold"
						class:text-white={!formLoading && formSubmittable}
						class:text-gray-300={formLoading || !formSubmittable}
						class:bg-gray-400={formLoading || !formSubmittable}
					>
						{formLoading ? "Saving..." : "Save"}
					</button>
				{/if}
			</div>
		</div>
	</div>
</form>
