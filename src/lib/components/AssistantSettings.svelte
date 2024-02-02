<script lang="ts">
	import type { readAndCompressImage } from "browser-image-resizer";
	import type { Model } from "$lib/types/Model";
	import type { Assistant } from "$lib/types/Assistant";

	import { onMount } from "svelte";
	import { applyAction, enhance } from "$app/forms";
	import { base } from "$app/paths";
	import CarbonPen from "~icons/carbon/pen";
	import CarbonUpload from "~icons/carbon/upload";
	import { useSettingsStore } from "$lib/stores/settings";
	import IconLoading from "./icons/IconLoading.svelte";

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

	function resetErrors() {
		if (form) {
			form.errors = [];
			form.error = false;
		}
	}

	function onFilesChange(e: Event) {
		const inputEl = e.target as HTMLInputElement;
		if (inputEl.files?.length && inputEl.files[0].size > 0) {
			if (!inputEl.files[0].type.includes("image")) {
				inputEl.files = null;
				files = null;

				form = { error: true, errors: [{ field: "avatar", message: "Only images are allowed" }] };
				return;
			}
			files = inputEl.files;
			resetErrors();
			deleteExistingAvatar = false;
		}
	}

	function getError(field: string, returnForm: ActionData) {
		return returnForm?.errors.find((error) => error.field === field)?.message ?? "";
	}

	let deleteExistingAvatar = false;

	let loading = false;
</script>

<form
	method="POST"
	class="flex h-full flex-col"
	enctype="multipart/form-data"
	use:enhance={async ({ formData }) => {
		loading = true;
		if (files?.[0] && files[0].size > 0 && compress) {
			await compress(files[0], {
				maxWidth: 500,
				maxHeight: 500,
				quality: 1,
			}).then((resizedImage) => {
				formData.set("avatar", resizedImage);
			});
		}

		if (deleteExistingAvatar === true) {
			if (assistant?.avatar) {
				// if there is an avatar we explicitly removei t
				formData.set("avatar", "null");
			} else {
				// else we just remove it from the input
				formData.delete("avatar");
			}
		} else {
			if (files === null) {
				formData.delete("avatar");
			}
		}

		return async ({ result }) => {
			loading = false;
			await applyAction(result);
		};
	}}
>
	{#if assistant}
		<h2 class="text-xl font-semibold">Edit assistant ({assistant?.name ?? ""})</h2>
		<p class="mb-6 text-sm text-gray-500">
			Modifying an existing assistant will propagate those changes to all users.
		</p>
	{:else}
		<h2 class="text-xl font-semibold">Create new assistant</h2>
		<p class="mb-6 text-sm text-gray-500">
			Create and share your own AI Assistant. All assistants are <span
				class="rounded-full border px-2 py-0.5 leading-none">public</span
			>
		</p>
	{/if}

	<div class="mx-1 grid flex-1 grid-cols-2 gap-4 max-sm:grid-cols-1">
		<div class="flex flex-col gap-4">
			<div>
				<span class="mb-1 block pb-2 text-sm font-semibold">Avatar</span>
				<input
					type="file"
					accept="image/*"
					name="avatar"
					id="avatar"
					class="hidden"
					on:change={onFilesChange}
				/>

				{#if (files && files[0]) || (assistant?.avatar && !deleteExistingAvatar)}
					<div class="group relative mx-auto h-12 w-12">
						{#if files && files[0]}
							<img
								src={URL.createObjectURL(files[0])}
								alt="avatar"
								class="crop mx-auto h-12 w-12 cursor-pointer rounded-full object-cover"
							/>
						{:else if assistant?.avatar}
							<img
								src="{base}/settings/assistants/{assistant._id}/avatar.jpg?hash={assistant.avatar}"
								alt="avatar"
								class="crop mx-auto h-12 w-12 cursor-pointer rounded-full object-cover"
							/>
						{/if}

						<label
							for="avatar"
							class="invisible absolute bottom-0 h-12 w-12 rounded-full bg-black bg-opacity-50 p-1 group-hover:visible hover:visible"
						>
							<CarbonPen class="mx-auto my-auto h-full cursor-pointer text-center text-white" />
						</label>
					</div>
					<div class="mx-auto w-max pt-1">
						<button
							type="button"
							on:click|stopPropagation|preventDefault={() => {
								files = null;
								deleteExistingAvatar = true;
							}}
							class="mx-auto w-max text-center text-xs text-gray-600 hover:underline"
						>
							Delete
						</button>
					</div>
				{:else}
					<div class="mb-1 flex w-max flex-row gap-4">
						<label
							for="avatar"
							class="btn flex h-8 rounded-lg border bg-white px-3 py-1 text-gray-500 shadow-sm transition-all hover:bg-gray-100"
						>
							<CarbonUpload class="mr-2 text-xs " /> Upload
						</label>
					</div>
				{/if}
				<p class="text-xs text-red-500">{getError("avatar", form)}</p>
			</div>

			<label>
				<span class="mb-1 text-sm font-semibold">Name</span>
				<input
					name="name"
					class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
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
					{#each models.filter((model) => !model.unlisted) as model}
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
				<span class="mb-1 text-sm font-semibold">User start messages</span>
				<div class="flex flex-col gap-2 md:max-h-32">
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

		<label class="flex flex-col">
			<span class="mb-1 text-sm font-semibold"> Instructions (system prompt) </span>
			<textarea
				name="preprompt"
				class="min-h-[8lh] flex-1 rounded-lg border-2 border-gray-200 bg-gray-100 p-2 text-sm"
				placeholder="You'll act as..."
				value={assistant?.preprompt ?? ""}
			/>
			<p class="text-xs text-red-500">{getError("preprompt", form)}</p>
		</label>
	</div>

	<div class="mt-5 flex justify-end gap-2">
		<a
			href={assistant ? `${base}/settings/assistants/${assistant?._id}` : `${base}/settings`}
			class="rounded-full bg-gray-200 px-8 py-2 font-semibold text-gray-600">Cancel</a
		>
		<button
			type="submit"
			disabled={loading}
			aria-disabled={loading}
			class="rounded-full bg-black px-8 py-2 font-semibold md:px-20"
			class:bg-gray-200={loading}
			class:text-gray-600={loading}
			class:text-white={!loading}
		>
			{assistant ? "Save" : "Create"}
			{#if loading}
				<IconLoading classNames="ml-2 h-min" />
			{/if}
		</button>
	</div>
</form>
