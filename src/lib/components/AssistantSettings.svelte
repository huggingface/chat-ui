<script lang="ts">
	import type { readAndCompressImage } from "browser-image-resizer";
	import type { Model } from "$lib/types/Model";
	import type { Assistant } from "$lib/types/Assistant";

	import { onMount } from "svelte";
	import { applyAction, enhance } from "$app/forms";
	import { page } from "$app/stores";
	import { base } from "$app/paths";
	import CarbonPen from "~icons/carbon/pen";
	import CarbonUpload from "~icons/carbon/upload";

	import { useSettingsStore } from "$lib/stores/settings";
	import { isHuggingChat } from "$lib/utils/isHuggingChat";

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

	let ragMode: false | "links" | "domains" | "all" = assistant?.rag?.allowAllDomains
		? "all"
		: assistant?.rag?.allowedLinks?.length ?? 0 > 0
		? "links"
		: (assistant?.rag?.allowedDomains?.length ?? 0) > 0
		? "domains"
		: false;
</script>

<form
	method="POST"
	class="flex h-full flex-col overflow-y-auto p-4 md:p-8"
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

		formData.delete("ragMode");

		if (ragMode === false || !$page.data.enableAssistantsRAG) {
			formData.set("ragAllowAll", "false");
			formData.set("ragLinkList", "");
			formData.set("ragDomainList", "");
		} else if (ragMode === "all") {
			formData.set("ragAllowAll", "true");
			formData.set("ragLinkList", "");
			formData.set("ragDomainList", "");
		} else if (ragMode === "links") {
			formData.set("ragAllowAll", "false");
			formData.set("ragDomainList", "");
		} else if (ragMode === "domains") {
			formData.set("ragAllowAll", "false");
			formData.set("ragLinkList", "");
		}

		return async ({ result }) => {
			loading = false;
			await applyAction(result);
		};
	}}
>
	{#if assistant}
		<h2 class="text-xl font-semibold">
			Edit {assistant?.name ?? "assistant"}
		</h2>
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

	<div class="grid h-full w-full flex-1 grid-cols-2 gap-6 text-sm max-sm:grid-cols-1">
		<div class="col-span-1 flex flex-col gap-4">
			<div>
				<div class="mb-1 block pb-2 text-sm font-semibold">Avatar</div>
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
				<div class="mb-1 font-semibold">Name</div>
				<input
					name="name"
					class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
					placeholder="My awesome model"
					value={assistant?.name ?? ""}
				/>
				<p class="text-xs text-red-500">{getError("name", form)}</p>
			</label>

			<label>
				<div class="mb-1 font-semibold">Description</div>
				<textarea
					name="description"
					class="h-15 w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
					placeholder="He knows everything about python"
					value={assistant?.description ?? ""}
				/>
				<p class="text-xs text-red-500">{getError("description", form)}</p>
			</label>

			<label>
				<div class="mb-1 font-semibold">Model</div>
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
				<div class="mb-1 font-semibold">User start messages</div>
				<div class="flex flex-col gap-2">
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
			{#if $page.data.enableAssistantsRAG}
				<div class="mb-4 flex flex-col flex-nowrap">
					<span class="mt-2 text-smd font-semibold"
						>Internet access <span
							class="ml-1 rounded bg-gray-100 px-1 py-0.5 text-xxs font-normal text-gray-600"
							>Experimental</span
						>

						{#if isHuggingChat}
							<a
								href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions/385"
								target="_blank"
								class="ml-0.5 rounded bg-gray-100 px-1 py-0.5 text-xxs font-normal text-gray-700 underline decoration-gray-400"
								>Give feedback</a
							>
						{/if}
					</span>

					<label class="mt-1">
						<input
							checked={!ragMode}
							on:change={() => (ragMode = false)}
							type="radio"
							name="ragMode"
							value={false}
						/>
						<span class="my-2 text-sm" class:font-semibold={!ragMode}> Disabled </span>
						{#if !ragMode}
							<span class="block text-xs text-gray-500">
								Assistant won't look for information from Internet and will be faster to answer.
							</span>
						{/if}
					</label>

					<label class="mt-1">
						<input
							checked={ragMode === "all"}
							on:change={() => (ragMode = "all")}
							type="radio"
							name="ragMode"
							value={"all"}
						/>
						<span class="my-2 text-sm" class:font-semibold={ragMode === "all"}> Web search </span>
						{#if ragMode === "all"}
							<span class="block text-xs text-gray-500">
								Assistant will do a web search on each user request to find information.
							</span>
						{/if}
					</label>

					<label class="mt-1">
						<input
							checked={ragMode === "domains"}
							on:change={() => (ragMode = "domains")}
							type="radio"
							name="ragMode"
							value={false}
						/>
						<span class="my-2 text-sm" class:font-semibold={ragMode === "domains"}>
							Domains search
						</span>
					</label>
					{#if ragMode === "domains"}
						<span class="mb-2 text-xs text-gray-500">
							Specify domains and URLs that the application can search, separated by commas.
						</span>

						<input
							name="ragDomainList"
							class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
							placeholder="wikipedia.org,bbc.com"
							value={assistant?.rag?.allowedDomains?.join(",") ?? ""}
						/>
						<p class="text-xs text-red-500">{getError("ragDomainList", form)}</p>
					{/if}

					<label class="mt-1">
						<input
							checked={ragMode === "links"}
							on:change={() => (ragMode = "links")}
							type="radio"
							name="ragMode"
							value={false}
						/>
						<span class="my-2 text-sm" class:font-semibold={ragMode === "links"}>
							Specific Links
						</span>
					</label>
					{#if ragMode === "links"}
						<span class="mb-2 text-xs text-gray-500">
							Specify a maximum of 10 direct URLs that the Assistant will access. HTML & Plain Text
							only, separated by commas
						</span>
						<input
							name="ragLinkList"
							class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
							placeholder="https://raw.githubusercontent.com/huggingface/chat-ui/main/README.md"
							value={assistant?.rag?.allowedLinks.join(",") ?? ""}
						/>
						<p class="text-xs text-red-500">{getError("ragLinkList", form)}</p>
					{/if}
				</div>
			{/if}
		</div>

		<div class="col-span-1 flex h-full flex-col">
			<span class="mb-1 text-sm font-semibold"> Instructions (system prompt) </span>
			<textarea
				name="preprompt"
				class="mb-20 min-h-[8lh] flex-1 rounded-lg border-2 border-gray-200 bg-gray-100 p-2 text-sm"
				placeholder="You'll act as..."
				value={assistant?.preprompt ?? ""}
			/>
			<p class="text-xs text-red-500">{getError("preprompt", form)}</p>
		</div>
	</div>

	<div class="fixed bottom-6 right-6 ml-auto mt-6 flex w-fit justify-end gap-2 sm:absolute">
		<a
			href={assistant ? `${base}/settings/assistants/${assistant?._id}` : `${base}/settings`}
			class="flex items-center justify-center rounded-full bg-gray-200 px-5 py-2 font-semibold text-gray-600"
		>
			Cancel
		</a>
		<button
			type="submit"
			disabled={loading}
			aria-disabled={loading}
			class="flex items-center justify-center rounded-full bg-black px-8 py-2 font-semibold"
			class:bg-gray-200={loading}
			class:text-gray-600={loading}
			class:text-white={!loading}
		>
			{assistant ? "Save" : "Create"}
		</button>
	</div>
</form>
