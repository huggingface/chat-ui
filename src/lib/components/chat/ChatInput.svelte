<script lang="ts">
	import { onDestroy, onMount, tick } from "svelte";

	import { afterNavigate } from "$app/navigation";

	import { DropdownMenu } from "bits-ui";
	import IconPlus from "~icons/lucide/plus";
	import CarbonImage from "~icons/carbon/image";
	import CarbonDocument from "~icons/carbon/document";
	import CarbonUpload from "~icons/carbon/upload";
	import CarbonLink from "~icons/carbon/link";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import CarbonClose from "~icons/carbon/close";
	import UrlFetchModal from "./UrlFetchModal.svelte";
	import { TEXT_MIME_ALLOWLIST, IMAGE_MIME_ALLOWLIST_DEFAULT } from "$lib/constants/mime";
	import MCPServerManager from "$lib/components/mcp/MCPServerManager.svelte";
	import IconMCP from "$lib/components/icons/IconMCP.svelte";
	import HfHubMentionAutocomplete from "./HfHubMentionAutocomplete.svelte";
	import MlInternPill from "./MlInternPill.svelte";

	import { isVirtualKeyboard } from "$lib/utils/isVirtualKeyboard";
	import { requireAuthUser } from "$lib/utils/auth";
	import {
		enabledServersCount,
		selectedServerIds,
		allMcpServers,
		toggleServer,
		disableAllServers,
	} from "$lib/stores/mcpServers";
	import { getMcpServerFaviconUrl } from "$lib/utils/favicon";
	import { type HfHubResource } from "$lib/utils/hfHubSearch";
	import { HubMentionState } from "$lib/utils/hubMention.svelte";
	import { getCaretCoordinates } from "$lib/utils/caretCoordinates";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import { page } from "$app/state";

	interface Props {
		files?: File[];
		mimeTypes?: string[];
		value?: string;
		placeholder?: string;
		loading?: boolean;
		disabled?: boolean;
		// tools removed
		modelIsMultimodal?: boolean;
		// Whether the currently selected model supports tool calling (incl. overrides)
		modelSupportsTools?: boolean;
		// Offers the ML Intern mode switch beside the MCP pill (empty conversations only)
		showMlPill?: boolean;
		children?: import("svelte").Snippet;
		onPaste?: (e: ClipboardEvent) => void;
		focused?: boolean;
		onsubmit?: () => void;
	}

	let {
		files = $bindable([]),
		mimeTypes = [],
		value = $bindable(""),
		placeholder = "",
		loading = false,
		disabled = false,

		modelIsMultimodal = false,
		modelSupportsTools = true,
		showMlPill = false,
		children,
		onPaste,
		focused = $bindable(false),
		onsubmit,
	}: Props = $props();

	const onFileChange = async (e: Event) => {
		if (!e.target) return;
		const target = e.target as HTMLInputElement;
		const selected = Array.from(target.files ?? []);
		if (selected.length === 0) return;
		files = [...files, ...selected];
		await tick();
		void focusTextarea();
	};

	let textareaElement: HTMLTextAreaElement | undefined = $state();
	let isCompositionOn = $state(false);
	let blurTimeout: ReturnType<typeof setTimeout> | null = $state(null);
	let hubBlurTimeout: ReturnType<typeof setTimeout> | null = null;

	// Hub mentions reach out to huggingface.co, so they are a HuggingChat
	// feature: a self-hosted deployment must not send a prefix of whatever the
	// user typed to a third party, and an air-gapped one cannot anyway.
	const publicConfig = usePublicConfig();
	const hub = new HubMentionState({ enabled: publicConfig.isHuggingChat });
	const isHubMentionOpen = $derived(hub.open);

	/** Panel anchor: the `@` of the mention being edited, in composer space. */
	let hubAnchor = $state({ left: 0, bottom: 0 });
	/** Panel width, kept in step with the `w-72` on the listbox. */
	const HUB_PANEL_WIDTH = 288;
	function updateHubAnchor() {
		const mention = hub.mention;
		if (!textareaElement || !mention) return;
		const caret = getCaretCoordinates(textareaElement, mention.start);
		const parent =
			textareaElement.offsetParent instanceof HTMLElement ? textareaElement.offsetParent : null;
		// Clamped so a mention typed near the right edge of a wide composer does
		// not push the panel off it.
		const maxLeft = Math.max(0, (parent?.clientWidth ?? 0) - HUB_PANEL_WIDTH);
		hubAnchor = {
			left: Math.min(Math.max(0, textareaElement.offsetLeft + caret.left), maxLeft),
			// Measured from the composer's bottom edge so the panel sits just above
			// the line the mention is on, clearing its glyphs.
			bottom: parent ? parent.clientHeight - (textareaElement.offsetTop + caret.top) + 4 : 0,
		};
	}

	let fileInputEl: HTMLInputElement | undefined = $state();
	let isUrlModalOpen = $state(false);
	let isMcpManagerOpen = $state(false);
	let isDropdownOpen = $state(false);

	function openPickerWithAccept(accept: string) {
		if (!fileInputEl) return;
		const allAccept = mimeTypes.join(",");
		fileInputEl.setAttribute("accept", accept);
		fileInputEl.click();
		queueMicrotask(() => fileInputEl?.setAttribute("accept", allAccept));
	}

	function openFilePickerText() {
		const textAccept =
			mimeTypes.filter((m) => !(m === "image/*" || m.startsWith("image/"))).join(",") ||
			TEXT_MIME_ALLOWLIST.join(",");
		openPickerWithAccept(textAccept);
	}

	function openFilePickerImage() {
		const imageAccept =
			mimeTypes.filter((m) => m === "image/*" || m.startsWith("image/")).join(",") ||
			IMAGE_MIME_ALLOWLIST_DEFAULT.join(",");
		openPickerWithAccept(imageAccept);
	}

	const waitForAnimationFrame = () =>
		typeof requestAnimationFrame === "function"
			? new Promise<void>((resolve) => {
					requestAnimationFrame(() => resolve());
				})
			: Promise.resolve();

	async function focusTextarea() {
		if (page.data.shared && page.data.loginEnabled && !page.data.user) return;
		if (!textareaElement || textareaElement.disabled || isVirtualKeyboard()) return;
		if (typeof document !== "undefined" && document.activeElement === textareaElement) return;

		await tick();

		if (typeof requestAnimationFrame === "function") {
			await waitForAnimationFrame();
			await waitForAnimationFrame();
		}

		if (!textareaElement || textareaElement.disabled || isVirtualKeyboard()) return;

		try {
			textareaElement.focus({ preventScroll: true });
		} catch {
			textareaElement.focus();
		}

		// Retry only when focus failed due to #app being inert (modal closing transition)
		if (
			typeof document !== "undefined" &&
			document.activeElement !== textareaElement &&
			document.getElementById("app")?.hasAttribute("inert")
		) {
			setTimeout(() => {
				if (!textareaElement || textareaElement.disabled || isVirtualKeyboard()) return;
				if (document.activeElement === textareaElement) return;
				try {
					textareaElement.focus({ preventScroll: true });
				} catch {
					textareaElement.focus();
				}
			}, 350);
		}
	}

	function handleFetchedFiles(newFiles: File[]) {
		if (!newFiles?.length) return;
		files = [...files, ...newFiles];
		queueMicrotask(async () => {
			await tick();
			void focusTextarea();
		});
	}

	onMount(() => {
		void focusTextarea();
	});

	onDestroy(() => {
		if (hubBlurTimeout) clearTimeout(hubBlurTimeout);
		hub.destroy();
	});

	afterNavigate(() => {
		void focusTextarea();
	});

	function adjustTextareaHeight() {
		if (!textareaElement) {
			return;
		}

		textareaElement.style.height = "auto";
		textareaElement.style.height = `${textareaElement.scrollHeight}px`;

		if (textareaElement.selectionStart === textareaElement.value.length) {
			textareaElement.scrollTop = textareaElement.scrollHeight;
		}
	}

	$effect(() => {
		if (!textareaElement) return;
		void value;
		adjustTextareaHeight();
	});

	function syncHubMentionFromTextarea() {
		if (!textareaElement) return;
		hub.update(textareaElement.value, textareaElement.selectionStart);
		updateHubAnchor();
	}

	function handleInput(event: Event) {
		const target = event.currentTarget as HTMLTextAreaElement;
		if (disabled) return;
		hub.update(target.value, target.selectionStart);
		updateHubAnchor();
	}

	// The textarea reports its own edits; a programmatic write (ChatWindow
	// clearing the draft on submit) reports nothing, so the panel has to notice
	// the mention it was tracking is gone.
	$effect(() => {
		hub.syncValue(value);
	});

	async function selectHubResult(result: HfHubResource) {
		const replacement = hub.accept(value, result);
		if (!replacement) return;
		value = replacement.value;

		await tick();
		textareaElement?.focus();
		textareaElement?.setSelectionRange(replacement.caret, replacement.caret);
		adjustTextareaHeight();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (isHubMentionOpen && !isCompositionOn) {
			if (event.key === "ArrowDown" && hub.results.length > 0) {
				event.preventDefault();
				hub.move(1);
				return;
			}
			if (event.key === "ArrowUp" && hub.results.length > 0) {
				event.preventDefault();
				hub.move(-1);
				return;
			}
			// Tab accepts the first result outright; Enter only accepts once the
			// user has arrowed into the list. Otherwise `ping @john` would be
			// rewritten and the send swallowed by whatever the Hub matched, and on
			// a phone Enter is the newline key with no Escape to back out with.
			if (event.key === "Tab" && !event.shiftKey && hub.results.length > 0) {
				event.preventDefault();
				void selectHubResult(hub.activeResult ?? hub.results[0]);
				return;
			}
			if (event.key === "Enter" && !event.shiftKey && hub.activeResult) {
				event.preventDefault();
				void selectHubResult(hub.activeResult);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				hub.dismiss();
				return;
			}
		}

		if (
			event.key === "Enter" &&
			!event.shiftKey &&
			!isCompositionOn &&
			!isVirtualKeyboard() &&
			value.trim() !== ""
		) {
			event.preventDefault();
			tick();
			onsubmit?.();
		}
	}

	function handleFocus() {
		if (requireAuthUser()) {
			return;
		}
		if (blurTimeout) {
			clearTimeout(blurTimeout);
			blurTimeout = null;
		}
		if (hubBlurTimeout) {
			clearTimeout(hubBlurTimeout);
			hubBlurTimeout = null;
		}
		focused = true;
		// Deliberately does NOT open the panel: focusing a restored draft that
		// happens to end in an @token would fire a request and hijack Enter
		// before the user has typed anything.
	}

	function handleBlur() {
		if (hubBlurTimeout) clearTimeout(hubBlurTimeout);
		hubBlurTimeout = setTimeout(() => {
			hubBlurTimeout = null;
			hub.reset();
		}, 100);

		if (!isVirtualKeyboard()) {
			focused = false;
			return;
		}

		if (blurTimeout) {
			clearTimeout(blurTimeout);
		}

		blurTimeout = setTimeout(() => {
			blurTimeout = null;
			focused = false;
		});
	}

	// Show file upload when any mime is allowed (text always; images if multimodal)
	let showFileUpload = $derived(mimeTypes.length > 0);
	let showNoTools = $derived(!showFileUpload);
	let selectedServers = $derived(
		$allMcpServers.filter((server) => $selectedServerIds.has(server.id))
	);
</script>

<div class="flex min-h-full flex-1 flex-col" onpaste={onPaste}>
	<!-- autocomplete=off is not autofill: it opts the composer out of the
	     browser's session form-state restore, which otherwise re-pastes an
	     already-sent prompt into the box on reload mid-generation (the value
	     typed on / travels into this page's history entry across the SPA
	     navigation, and the restore bypasses the Svelte binding). -->
	<div class="relative">
		{#if isHubMentionOpen}
			<HfHubMentionAutocomplete
				results={hub.results}
				status={hub.status ?? "loading"}
				activeIndex={hub.activeIndex}
				caretAnchor={hubAnchor}
				onselect={(result) => void selectHubResult(result)}
				onactivechange={(index) => hub.setActiveIndex(index)}
			/>
		{/if}

		<textarea
			rows="1"
			tabindex="0"
			inputmode="text"
			autocomplete="off"
			role="combobox"
			aria-autocomplete="list"
			aria-expanded={isHubMentionOpen}
			aria-controls={isHubMentionOpen ? "hf-hub-mention-listbox" : undefined}
			aria-activedescendant={isHubMentionOpen && hub.activeIndex >= 0
				? `hf-hub-mention-option-${hub.activeIndex}`
				: undefined}
			class="scrollbar-custom max-h-[4lh] w-full resize-none overflow-x-hidden overflow-y-auto border-0 bg-transparent px-2.5 py-2.5 outline-hidden focus:ring-0 focus-visible:ring-0 sm:px-3 md:max-h-[8lh]"
			class:text-gray-400={disabled}
			bind:value
			bind:this={textareaElement}
			oninput={handleInput}
			onkeydown={handleKeydown}
			onkeyup={(event) => {
				// Vertical arrows are only intercepted once results exist; while the
				// search is in flight they move the caret like any other key, so the
				// tracked mention has to follow them too.
				if (
					["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
				) {
					syncHubMentionFromTextarea();
				}
			}}
			onclick={syncHubMentionFromTextarea}
			onselect={syncHubMentionFromTextarea}
			oncompositionstart={() => (isCompositionOn = true)}
			oncompositionend={() => {
				isCompositionOn = false;
				syncHubMentionFromTextarea();
			}}
			{placeholder}
			{disabled}
			onfocus={handleFocus}
			onblur={handleBlur}
			onbeforeinput={requireAuthUser}
		></textarea>
	</div>

	{#if !showNoTools || showMlPill}
		<div
			class={[
				"-ml-0.5 scrollbar-custom flex max-w-[calc(100%-40px)] flex-wrap items-center justify-start gap-2.5 px-3 pt-1.5 pb-2.5 text-gray-500 max-md:flex-nowrap max-md:overflow-x-auto sm:gap-2 dark:text-gray-400",
			]}
		>
			{#if showFileUpload}
				<div class="flex items-center">
					<input
						bind:this={fileInputEl}
						disabled={loading}
						class="absolute hidden size-0"
						aria-label="Upload file"
						type="file"
						multiple
						onchange={onFileChange}
						onclick={(e) => {
							if (requireAuthUser()) {
								e.preventDefault();
							}
						}}
						accept={mimeTypes.join(",")}
					/>

					<DropdownMenu.Root
						bind:open={isDropdownOpen}
						onOpenChange={(open) => {
							if (open && requireAuthUser()) {
								isDropdownOpen = false;
								return;
							}
							isDropdownOpen = open;
						}}
					>
						<DropdownMenu.Trigger
							class="btn size-8 rounded-full border bg-white text-black shadow-sm transition-none enabled:hover:bg-white enabled:hover:shadow-inner sm:size-7 dark:border-transparent dark:bg-gray-600/50 dark:text-white dark:hover:enabled:bg-gray-600"
							disabled={loading}
							aria-label="Add attachment"
						>
							<IconPlus class="text-base sm:text-sm" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Portal>
							<DropdownMenu.Content
								class="z-50 rounded-xl border border-gray-200 bg-white/95 p-1 text-gray-800 shadow-lg backdrop-blur-sm dark:border-gray-700/60 dark:bg-gray-800/95 dark:text-gray-100"
								side="top"
								sideOffset={8}
								align="start"
								trapFocus={false}
								onCloseAutoFocus={(e) => e.preventDefault()}
								interactOutsideBehavior="defer-otherwise-close"
							>
								{#if modelIsMultimodal}
									<DropdownMenu.Item
										class="flex h-9 items-center gap-1 rounded-md px-2 text-sm text-gray-700 select-none focus-visible:outline-hidden data-highlighted:bg-gray-100 sm:h-8 dark:text-gray-200 dark:data-highlighted:bg-white/10"
										onSelect={() => openFilePickerImage()}
									>
										<CarbonImage class="size-4 opacity-90 dark:opacity-80" />
										Add image(s)
									</DropdownMenu.Item>
								{/if}

								<DropdownMenu.Sub>
									<DropdownMenu.SubTrigger
										class="flex h-9 items-center gap-1 rounded-md px-2 text-sm text-gray-700 select-none focus-visible:outline-hidden data-highlighted:bg-gray-100 data-[state=open]:bg-gray-100 sm:h-8 dark:text-gray-200 dark:data-highlighted:bg-white/10 dark:data-[state=open]:bg-white/10"
									>
										<div class="flex items-center gap-1">
											<CarbonDocument class="size-4 opacity-90 dark:opacity-80" />
											Add text file
										</div>
										<div class="ml-auto flex items-center">
											<CarbonChevronRight class="size-4 opacity-70 dark:opacity-80" />
										</div>
									</DropdownMenu.SubTrigger>
									<DropdownMenu.SubContent
										class="z-50 rounded-xl border border-gray-200 bg-white/95 p-1 text-gray-800 shadow-lg backdrop-blur-sm dark:border-gray-700/60 dark:bg-gray-800/95 dark:text-gray-100"
										sideOffset={10}
										trapFocus={false}
										onCloseAutoFocus={(e) => e.preventDefault()}
										interactOutsideBehavior="defer-otherwise-close"
									>
										<DropdownMenu.Item
											class="flex h-9 items-center gap-1 rounded-md px-2 text-sm text-gray-700 select-none focus-visible:outline-hidden data-highlighted:bg-gray-100 sm:h-8 dark:text-gray-200 dark:data-highlighted:bg-white/10"
											onSelect={() => openFilePickerText()}
										>
											<CarbonUpload class="size-4 opacity-90 dark:opacity-80" />
											Upload from device
										</DropdownMenu.Item>
										<DropdownMenu.Item
											class="flex h-9 items-center gap-1 rounded-md px-2 text-sm text-gray-700 select-none focus-visible:outline-hidden data-highlighted:bg-gray-100 sm:h-8 dark:text-gray-200 dark:data-highlighted:bg-white/10"
											onSelect={() => (isUrlModalOpen = true)}
										>
											<CarbonLink class="size-4 opacity-90 dark:opacity-80" />
											Fetch from URL
										</DropdownMenu.Item>
									</DropdownMenu.SubContent>
								</DropdownMenu.Sub>

								<!-- MCP Servers submenu -->
								<DropdownMenu.Sub>
									<DropdownMenu.SubTrigger
										class="flex h-9 items-center gap-1 rounded-md px-2 text-sm text-gray-700 select-none focus-visible:outline-hidden data-highlighted:bg-gray-100 data-[state=open]:bg-gray-100 sm:h-8 dark:text-gray-200 dark:data-highlighted:bg-white/10 dark:data-[state=open]:bg-white/10"
									>
										<div class="flex items-center gap-1">
											<IconMCP classNames="size-4 opacity-90 dark:opacity-80" />
											MCP Servers
										</div>
										<div class="ml-auto flex items-center">
											<CarbonChevronRight class="size-4 opacity-70 dark:opacity-80" />
										</div>
									</DropdownMenu.SubTrigger>
									<DropdownMenu.SubContent
										class="z-50 rounded-xl border border-gray-200 bg-white/95 p-1 text-gray-800 shadow-lg backdrop-blur-sm dark:border-gray-700/60 dark:bg-gray-800/95 dark:text-gray-100"
										sideOffset={10}
										trapFocus={false}
										onCloseAutoFocus={(e) => e.preventDefault()}
										interactOutsideBehavior="defer-otherwise-close"
									>
										{#each $allMcpServers as server (server.id)}
											<DropdownMenu.CheckboxItem
												checked={$selectedServerIds.has(server.id)}
												onCheckedChange={() => toggleServer(server.id)}
												closeOnSelect={false}
												class="flex h-9 items-center gap-2 rounded-md px-2 text-sm leading-none text-gray-800 select-none focus-visible:outline-hidden data-highlighted:bg-gray-100 dark:text-gray-100 dark:data-highlighted:bg-white/10"
											>
												{#snippet children({ checked })}
													<img
														src={getMcpServerFaviconUrl(server.url)}
														alt=""
														class="size-4 flex-shrink-0 rounded-sm"
													/>
													<span class="max-w-52 truncate py-1">{server.name}</span>
													<div class="ml-auto flex items-center">
														<!-- Toggle visual -->
														<span
															class={[
																"relative mt-px flex h-4 w-7 items-center self-center rounded-full transition-colors",
																checked ? "bg-blue-600/80" : "bg-gray-300 dark:bg-gray-700",
															]}
														>
															<span
																class={[
																	"block size-3 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform",
																	checked ? "translate-x-[14px]" : "translate-x-0.5",
																]}
															></span>
														</span>
													</div>
												{/snippet}
											</DropdownMenu.CheckboxItem>
										{/each}

										{#if $allMcpServers.length > 0}
											<DropdownMenu.Separator class="my-1 h-px bg-gray-200 dark:bg-gray-700/60" />
										{/if}
										<DropdownMenu.Item
											class="flex h-9 items-center gap-1 rounded-md px-2 text-sm text-gray-700 select-none focus-visible:outline-hidden data-highlighted:bg-gray-100 sm:h-8 dark:text-gray-200 dark:data-highlighted:bg-white/10"
											onSelect={() => (isMcpManagerOpen = true)}
										>
											Manage MCP Servers
										</DropdownMenu.Item>
									</DropdownMenu.SubContent>
								</DropdownMenu.Sub>
							</DropdownMenu.Content>
						</DropdownMenu.Portal>
					</DropdownMenu.Root>

					{#if $enabledServersCount > 0}
						<div
							class="ml-1.5 inline-flex h-8 items-center gap-1.5 rounded-full bg-blue-600/10 pr-1 pl-2 text-xs font-semibold text-blue-700 sm:h-7 dark:bg-blue-600/20 dark:text-blue-400"
							class:grayscale={!modelSupportsTools}
							class:opacity-60={!modelSupportsTools}
							class:cursor-help={!modelSupportsTools}
							title={modelSupportsTools
								? "MCP servers enabled"
								: "Current model doesn’t support tools"}
						>
							<button
								class="inline-flex cursor-pointer items-center gap-1 bg-transparent p-0 leading-none whitespace-nowrap text-current select-none focus:outline-hidden"
								type="button"
								title="Manage MCP Servers"
								onclick={() => (isMcpManagerOpen = true)}
								class:line-through={!modelSupportsTools}
							>
								{#if selectedServers.length}
									<span class="flex items-center -space-x-1">
										{#each selectedServers.slice(0, 3) as server (server.id)}
											<img
												src={getMcpServerFaviconUrl(server.url)}
												alt=""
												class="size-4 rounded-sm bg-white p-px shadow-xs ring-1 ring-black/5 dark:bg-gray-900 dark:ring-white/10"
											/>
										{/each}
										{#if selectedServers.length > 3}
											<span class="ml-1 text-[10px] font-semibold text-blue-800 dark:text-blue-200">
												+{selectedServers.length - 3}
											</span>
										{/if}
									</span>
								{/if}
								MCP ({$enabledServersCount})
							</button>
							<button
								class="grid size-5 place-items-center rounded-full bg-blue-600/15 text-blue-700 transition-colors hover:bg-blue-600/25 dark:bg-blue-600/25 dark:text-blue-300 dark:hover:bg-blue-600/35"
								aria-label="Disable all MCP servers"
								onclick={() => disableAllServers()}
								type="button"
							>
								<CarbonClose class="size-3.5" />
							</button>
						</div>
					{/if}
				</div>
			{/if}

			{#if showMlPill}
				<MlInternPill />
			{/if}
		</div>
	{/if}
	{@render children?.()}

	<UrlFetchModal
		bind:open={isUrlModalOpen}
		acceptMimeTypes={mimeTypes}
		onfiles={handleFetchedFiles}
	/>

	{#if isMcpManagerOpen}
		<MCPServerManager onclose={() => (isMcpManagerOpen = false)} />
	{/if}
</div>

<style>
	/* In the base layer so utility classes (font-mono, text-xs, prose) keep
	   winning over these element selectors, as they did before Tailwind v4 */
	@layer base {
		:global(pre),
		:global(textarea) {
			font-family: inherit;
			box-sizing: border-box;
			line-height: 1.5;
			font-size: 16px;
		}
	}
</style>
