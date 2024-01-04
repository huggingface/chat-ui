<script lang="ts">
	import type { readAndCompressImage } from "browser-image-resizer";
	import type { Model } from "$lib/types/Model";
	import type { Assistant } from "$lib/types/Assistant";

	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { base } from "$app/paths";
	import CarbonPen from "~icons/carbon/pen";
	import { useSettingsStore } from "$lib/stores/settings";

	type ActionData = {
		error: boolean;
		errors: {
			field: string | number;
			message: string;
		}[];
	} | null;

	type AssistantFront = Omit<Assistant, "_id" | "createdById"> & { _id: string };

	export let form: ActionData;
	export let assistant: AssistantFront | undefined = undefined;
	export let models: Model[] = [];

	let files: FileList | null = null;

	const settings = useSettingsStore();

	let compress: typeof readAndCompressImage | null = null;

	onMount(async () => {
		const module = await import("browser-image-resizer");
		compress = module.readAndCompressImage;
	});

	let inputMessage1 = assistant?.exampleInputs[0] ?? "";
	let inputMessage2 = assistant?.exampleInputs[1] ?? "";
	let inputMessage3 = assistant?.exampleInputs[2] ?? "";
	let inputMessage4 = assistant?.exampleInputs[3] ?? "";

	function onFilesChange(e: Event) {
		const inputEl = e.target as HTMLInputElement;
		if (inputEl.files?.length) {
			files = inputEl.files;
		}
	}

	function getError(field: string, returnForm: ActionData) {
		return returnForm?.errors.find((error) => error.field === field)?.message ?? "";
	}
</script>

<form
	method="POST"
	class="h-full w-full overflow-x-clip"
	enctype="multipart/form-data"
	use:enhance={async ({ formData }) => {
		const avatar = formData.get("avatar");

		if (avatar && typeof avatar !== "string" && avatar.size > 0 && compress) {
			await compress(avatar, {
				maxWidth: 500,
				maxHeight: 500,
				quality: 1,
			}).then((resizedImage) => {
				formData.set("avatar", resizedImage);
			});
		}
	}}
>
	{#if assistant}
		<h2 class="text-xl font-semibold">Edit {assistant?.name ?? ""}</h2>
		<p class="mb-8 text-sm text-gray-500">
			Modifying an existing assistant will propagate those changes to all users.
		</p>
	{:else}
		<h2 class="text-xl font-semibold">Create new assistant</h2>
		<p class="mb-8 text-sm text-gray-500">
			Assistants are public, and can be accessed by anyone with the link.
		</p>
	{/if}

	<div class="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
		<div class="flex flex-col gap-4 px-2">
			<label class="truncate">
				<span class="mb-1 block text-sm font-semibold">Avatar</span>
				<input
					type="file"
					accept="image/*"
					name="avatar"
					class="invisible z-10 block h-0 w-0"
					on:change={onFilesChange}
				/>
				{#if (files && files[0]) || assistant?.avatar}
					<div class="group relative h-12 w-12">
						{#if files && files[0]}
							<img
								src={URL.createObjectURL(files[0])}
								alt="avatar"
								class="crop mx-auto h-12 w-12 cursor-pointer rounded-full"
							/>
						{:else if assistant?.avatar}
							<img
								src="{base}/settings/assistants/{assistant._id}/avatar?hash={assistant.avatar}"
								alt="avatar"
								class="crop mx-auto h-12 w-12 cursor-pointer rounded-full"
							/>
						{/if}

						<div
							class="invisible absolute bottom-0 h-12 w-12 rounded-full bg-black bg-opacity-50 p-1 group-hover:visible hover:visible"
						>
							<CarbonPen class="mx-auto my-auto h-full cursor-pointer text-center text-white" />
						</div>
					</div>
					<button
						type="button"
						on:click|stopPropagation|preventDefault={() => (files = null)}
						class="mt-1 text-xs text-gray-600 hover:underline"
					>
						Reset
					</button>
				{:else}
					<span class="text-xs text-gray-500 hover:underline">Click to upload</span>
				{/if}
				<p class="text-xs text-red-500">{getError("avatar", form)}</p>
			</label>

			<label>
				<span class="mb-1 text-sm font-semibold">Name</span>
				<input
					name="name"
					class=" w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
					placeholder="My awesome model"
					value={assistant?.name ?? ""}
				/>
				<p class="text-xs text-red-500">{getError("name", form)}</p>
			</label>

			<label>
				<span class="mb-1 text-sm font-semibold">Description</span>
				<textarea
					name="description"
					class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
					placeholder="He knows everything about python"
					value={assistant?.description ?? ""}
				/>
				<p class="text-xs text-red-500">{getError("description", form)}</p>
			</label>

			<label>
				<span class="mb-1 text-sm font-semibold">Model</span>
				<select name="modelId" class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2">
					{#each models as model}
						<option
							value={model.id}
							selected={assistant
								? assistant?.modelId === model.id
								: $settings.activeModel === model.id}>{model.displayName}</option
						>
					{/each}
					<p class="text-xs text-red-500">{getError("modelId", form)}</p>
				</select>
			</label>

			<label>
				<span class="mb-1 text-sm font-semibold">Start messages</span>
				<div class="flex flex-col gap-2 md:max-h-32 md:overflow-y-scroll">
					<input
						name="exampleInput1"
						bind:value={inputMessage1}
						class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
					/>
					{#if !!inputMessage1 || !!inputMessage2}
						<input
							name="exampleInput2"
							bind:value={inputMessage2}
							class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
						/>
					{/if}
					{#if !!inputMessage2 || !!inputMessage3}
						<input
							name="exampleInput3"
							bind:value={inputMessage3}
							class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
						/>
					{/if}
					{#if !!inputMessage3 || !!inputMessage4}
						<input
							name="exampleInput4"
							bind:value={inputMessage4}
							class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
						/>
					{/if}
				</div>
				<p class="text-xs text-red-500">{getError("inputMessage1", form)}</p>
			</label>
		</div>

		<div class="flex flex-col gap-4 px-2">
			<label class="h-full">
				<span class="mb-1 text-sm font-semibold"> Instructions (system prompt) </span>

				<textarea
					name="preprompt"
					class="h-64 w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2 text-sm"
					placeholder="You'll act as..."
					value={assistant?.preprompt ?? ""}
				/>

				<p class="text-xs text-red-500">{getError("preprompt", form)}</p>
			</label>
		</div>
	</div>

	<div class="my-3">
		<a
			href={assistant ? `${base}/settings/assistants/${assistant?._id}` : `${base}/settings`}
			class="rounded-full bg-gray-200 px-8 py-2 font-semibold text-gray-600">Cancel</a
		>

		<button type="submit" class="rounded-full bg-black px-8 py-2 font-semibold text-white md:px-20"
			>{assistant ? "Save" : "Create"}</button
		>
	</div>
</form>
