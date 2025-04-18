<script lang="ts">
	import { createBubbler } from "svelte/legacy";

	const bubble = createBubbler();
	import type { Message, MessageFile } from "$lib/types/Message";
	import { createEventDispatcher, onDestroy, tick, onMount } from "svelte";

	import CarbonExport from "~icons/carbon/export";
	import CarbonCheckmark from "~icons/carbon/checkmark";
	import CarbonCaretDown from "~icons/carbon/caret-down";

	import EosIconsLoading from "~icons/eos-icons/loading";

	import ChatInput from "./ChatInput.svelte";
	import StopGeneratingBtn from "../StopGeneratingBtn.svelte";
	import type { Model } from "$lib/types/Model";
	import { page } from "$app/state";
	import FileDropzone from "./FileDropzone.svelte";
	import RetryBtn from "../RetryBtn.svelte";
	import file2base64 from "$lib/utils/file2base64";
	import type { Assistant } from "$lib/types/Assistant";
	import { base } from "$app/paths";
	import ContinueBtn from "../ContinueBtn.svelte";
	import AssistantIntroduction from "./AssistantIntroduction.svelte";
	import ChatMessage from "./ChatMessage.svelte";
	import ScrollToBottomBtn from "../ScrollToBottomBtn.svelte";
	import ScrollToPreviousBtn from "../ScrollToPreviousBtn.svelte";
	import { browser } from "$app/environment";
	import { snapScrollToBottom } from "$lib/actions/snapScrollToBottom";
	import SystemPromptModal from "../SystemPromptModal.svelte";
	import ChatIntroduction from "./ChatIntroduction.svelte";
	import UploadedFile from "./UploadedFile.svelte";
	import { useSettingsStore } from "$lib/stores/settings";
	import ModelSwitch from "./ModelSwitch.svelte";

	import { fly } from "svelte/transition";
	import { cubicInOut } from "svelte/easing";
	import type { ToolFront } from "$lib/types/Tool";
	import { loginModalOpen } from "$lib/stores/loginModal";
	import { beforeNavigate } from "$app/navigation";
	interface Props {
		messages?: Message[];
		messagesAlternatives?: Message["id"][][];
		loading?: boolean;
		pending?: boolean;
		shared?: boolean;
		currentModel: Model;
		models: Model[];
		assistant?: Assistant | undefined;
		preprompt?: string | undefined;
		files?: File[];
	}

	let {
		messages = [],
		messagesAlternatives = [],
		loading = false,
		pending = false,
		shared = false,
		currentModel,
		models,
		assistant = undefined,
		preprompt = undefined,
		files = $bindable([]),
	}: Props = $props();

	let isReadOnly = $derived(!models.some((model) => model.id === currentModel.id));

	let message: string = $state("");
	let timeout: ReturnType<typeof setTimeout>;
	let isSharedRecently = $state(false);
	let editMsdgId: Message["id"] | null = $state(null);
	let pastedLongContent = $state(false);

	beforeNavigate(() => {
		if (page.params.id) {
			isSharedRecently = false;
		}
	});

	const dispatch = createEventDispatcher<{
		message: string;
		share: void;
		stop: void;
		retry: { id: Message["id"]; content?: string };
		continue: { id: Message["id"] };
	}>();

	const handleSubmit = () => {
		if (loading) return;
		dispatch("message", message);
		message = "";
	};

	let lastTarget: EventTarget | null = null;

	let onDrag = $state(false);

	const onDragEnter = (e: DragEvent) => {
		lastTarget = e.target;
		onDrag = true;
	};
	const onDragLeave = (e: DragEvent) => {
		if (e.target === lastTarget) {
			onDrag = false;
		}
	};

	const onPaste = (e: ClipboardEvent) => {
		const textContent = e.clipboardData?.getData("text");

		if (!$settings.directPaste && textContent && textContent.length >= 3984) {
			e.preventDefault();
			pastedLongContent = true;
			setTimeout(() => {
				pastedLongContent = false;
			}, 1000);
			const pastedFile = new File([textContent], "Pasted Content", {
				type: "application/vnd.chatui.clipboard",
			});

			files = [...files, pastedFile];
		}

		if (!e.clipboardData) {
			return;
		}

		// paste of files
		const pastedFiles = Array.from(e.clipboardData.files);
		if (pastedFiles.length !== 0) {
			e.preventDefault();

			// filter based on activeMimeTypes, including wildcards
			const filteredFiles = pastedFiles.filter((file) => {
				return activeMimeTypes.some((mimeType: string) => {
					const [type, subtype] = mimeType.split("/");
					const [fileType, fileSubtype] = file.type.split("/");
					return (
						(type === "*" || fileType === type) && (subtype === "*" || fileSubtype === subtype)
					);
				});
			});

			files = [...files, ...filteredFiles];
		}
	};

	let lastMessage = $derived(browser && (messages.at(-1) as Message));
	let lastIsError = $derived(
		lastMessage &&
			!loading &&
			(lastMessage.from === "user" ||
				lastMessage.updates?.findIndex((u) => u.type === "status" && u.status === "error") !== -1)
	);

	let sources = $derived(
		files?.map<Promise<MessageFile>>((file) =>
			file2base64(file).then((value) => ({
				type: "base64",
				value,
				mime: file.type,
				name: file.name,
			}))
		)
	);

	function onShare() {
		if (!confirm("Are you sure you want to share this conversation? This cannot be undone.")) {
			return;
		}

		dispatch("share");
		isSharedRecently = true;
		if (timeout) {
			clearTimeout(timeout);
		}
		timeout = setTimeout(() => {
			isSharedRecently = false;
		}, 2000);
	}

	onDestroy(() => {
		if (timeout) {
			clearTimeout(timeout);
		}
	});

	let chatContainer: HTMLElement | undefined = $state();

	async function scrollToBottom() {
		await tick();
		if (!chatContainer) return;
		chatContainer.scrollTop = chatContainer.scrollHeight;
	}

	// If last message is from user, scroll to bottom
	$effect(() => {
		if (lastMessage && lastMessage.from === "user") {
			scrollToBottom();
		}
	});

	const settings = useSettingsStore();

	let mimeTypesFromActiveTools = $derived(
		page.data.tools
			.filter((tool: ToolFront) => {
				if (assistant) {
					return assistant.tools?.includes(tool._id);
				}
				if (currentModel.tools) {
					return $settings?.tools?.includes(tool._id) ?? tool.isOnByDefault;
				}
				return false;
			})
			.flatMap((tool: ToolFront) => tool.mimeTypes ?? [])
	);

	let activeMimeTypes = $derived(
		Array.from(
			new Set([
				...mimeTypesFromActiveTools, // fetch mime types from active tools either from tool settings or active assistant
				...(currentModel.tools && !assistant ? ["application/pdf"] : []), // if its a tool model, we can always enable document parser so we always accept pdfs
				...(currentModel.multimodal
					? (currentModel.multimodalAcceptedMimetypes ?? ["image/*"])
					: []), // if its a multimodal model, we always accept images
			])
		)
	);
	let isFileUploadEnabled = $derived(activeMimeTypes.length > 0);
	let popupWindowContainer: HTMLDivElement | null;
	function handleKeyDown(e: KeyboardEvent) {
		if (e.ctrlKey && e.key === "k") {
			e.preventDefault();
			if (popupWindowContainer && popupWindowContainer.style.display === "none") {
				popupWindowContainer.style.display = "flex";
			} else if (popupWindowContainer) {
				popupWindowContainer.style.display = "none";
			}
		}
	}

	onMount(() => {
		popupWindowContainer = document.querySelector(".popup-window-container");
		if (popupWindowContainer) {
			popupWindowContainer.style.display = "none";
		}
		window.addEventListener("keydown", handleKeyDown);
	});
</script>

<svelte:window
	ondragenter={onDragEnter}
	ondragleave={onDragLeave}
	ondragover={(e) => {
		e.preventDefault();
		bubble("dragover");
	}}
	ondrop={(e) => {
		e.preventDefault();
		onDrag = false;
	}}
/>
<div
	class="popup-window-container absolute z-10 hidden h-[100%] w-[100%] items-center justify-center"
>
	<div
		class="popup z-2 w-[40rem] rounded-2xl border border-gray-700 bg-slate-900
		shadow-xl"
	>
		<div class="searchBar-container p-5">
			<input placeholder="Search chats..." class="bg-inherit outline-none" />
		</div>
		<div class="border-b-2 border-gray-700"></div>
		<div class="chat-container relative flex h-[25rem] flex-col gap-2 overflow-y-scroll p-5">
			<div
				class="flex cursor-pointer flex-row gap-3 rounded-lg p-2 font-[1rem] text-[#FFFFFF] transition-colors
			duration-150 ease-in-out hover:bg-slate-800"
			>
				<svg
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="currentColor"
					xmlns="http://www.w3.org/2000/svg"
					class="icon-sidebar text-token-text-secondary"
					><path
						d="M15.6729 3.91287C16.8918 2.69392 18.8682 2.69392 20.0871 3.91287C21.3061 5.13182 21.3061 7.10813 20.0871 8.32708L14.1499 14.2643C13.3849 15.0293 12.3925 15.5255 11.3215 15.6785L9.14142 15.9899C8.82983 16.0344 8.51546 15.9297 8.29289 15.7071C8.07033 15.4845 7.96554 15.1701 8.01005 14.8586L8.32149 12.6785C8.47449 11.6075 8.97072 10.615 9.7357 9.85006L15.6729 3.91287ZM18.6729 5.32708C18.235 4.88918 17.525 4.88918 17.0871 5.32708L11.1499 11.2643C10.6909 11.7233 10.3932 12.3187 10.3014 12.9613L10.1785 13.8215L11.0386 13.6986C11.6812 13.6068 12.2767 13.3091 12.7357 12.8501L18.6729 6.91287C19.1108 6.47497 19.1108 5.76499 18.6729 5.32708ZM11 3.99929C11.0004 4.55157 10.5531 4.99963 10.0008 5.00007C9.00227 5.00084 8.29769 5.00827 7.74651 5.06064C7.20685 5.11191 6.88488 5.20117 6.63803 5.32695C6.07354 5.61457 5.6146 6.07351 5.32698 6.63799C5.19279 6.90135 5.10062 7.24904 5.05118 7.8542C5.00078 8.47105 5 9.26336 5 10.4V13.6C5 14.7366 5.00078 15.5289 5.05118 16.1457C5.10062 16.7509 5.19279 17.0986 5.32698 17.3619C5.6146 17.9264 6.07354 18.3854 6.63803 18.673C6.90138 18.8072 7.24907 18.8993 7.85424 18.9488C8.47108 18.9992 9.26339 19 10.4 19H13.6C14.7366 19 15.5289 18.9992 16.1458 18.9488C16.7509 18.8993 17.0986 18.8072 17.362 18.673C17.9265 18.3854 18.3854 17.9264 18.673 17.3619C18.7988 17.1151 18.8881 16.7931 18.9393 16.2535C18.9917 15.7023 18.9991 14.9977 18.9999 13.9992C19.0003 13.4469 19.4484 12.9995 20.0007 13C20.553 13.0004 21.0003 13.4485 20.9999 14.0007C20.9991 14.9789 20.9932 15.7808 20.9304 16.4426C20.8664 17.116 20.7385 17.7136 20.455 18.2699C19.9757 19.2107 19.2108 19.9756 18.27 20.455C17.6777 20.7568 17.0375 20.8826 16.3086 20.9421C15.6008 21 14.7266 21 13.6428 21H10.3572C9.27339 21 8.39925 21 7.69138 20.9421C6.96253 20.8826 6.32234 20.7568 5.73005 20.455C4.78924 19.9756 4.02433 19.2107 3.54497 18.2699C3.24318 17.6776 3.11737 17.0374 3.05782 16.3086C2.99998 15.6007 2.99999 14.7266 3 13.6428V10.3572C2.99999 9.27337 2.99998 8.39922 3.05782 7.69134C3.11737 6.96249 3.24318 6.3223 3.54497 5.73001C4.02433 4.7892 4.78924 4.0243 5.73005 3.54493C6.28633 3.26149 6.88399 3.13358 7.55735 3.06961C8.21919 3.00673 9.02103 3.00083 9.99922 3.00007C10.5515 2.99964 10.9996 3.447 11 3.99929Z"
						fill="currentColor"
					></path></svg
				>
				<span>New chat</span>
			</div>
			<div class="chats today-chats flex flex-col gap-2">
				<span class="p-2">Today</span>
				<div
					class="flex cursor-pointer flex-row gap-3 rounded-lg p-2 transition-colors duration-150
			ease-in-out hover:bg-slate-800"
				>
					<svg
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
						class="icon-sidebar text-token-text-secondary"
						><path
							fill-rule="evenodd"
							clip-rule="evenodd"
							d="M8.52242 6.53608C9.7871 4.41979 12.1019 3 14.75 3C18.7541 3 22 6.24594 22 10.25C22 11.9007 21.4474 13.4239 20.5183 14.6425L21.348 15.97C21.5407 16.2783 21.5509 16.6668 21.3746 16.9848C21.1984 17.3027 20.8635 17.5 20.5 17.5H15.4559C14.1865 19.5963 11.883 21 9.25 21C9.18896 21 9.12807 20.9992 9.06735 20.9977C9.04504 20.9992 9.02258 21 9 21H3.5C3.13647 21 2.80158 20.8027 2.62536 20.4848C2.44913 20.1668 2.45933 19.7783 2.652 19.47L3.48171 18.1425C2.55263 16.9239 2 15.4007 2 13.75C2 9.99151 4.85982 6.90116 8.52242 6.53608ZM10.8938 6.68714C14.106 7.43177 16.5 10.3113 16.5 13.75C16.5 14.3527 16.4262 14.939 16.2871 15.5H18.6958L18.435 15.0828C18.1933 14.6961 18.2439 14.1949 18.5579 13.8643C19.4525 12.922 20 11.651 20 10.25C20 7.3505 17.6495 5 14.75 5C13.2265 5 11.8535 5.64888 10.8938 6.68714ZM8.89548 19C8.94178 18.9953 8.98875 18.9938 9.03611 18.9957C9.107 18.9986 9.17831 19 9.25 19C11.3195 19 13.1112 17.8027 13.9668 16.0586C14.3079 15.363 14.5 14.5804 14.5 13.75C14.5 10.8505 12.1495 8.5 9.25 8.5C9.21772 8.5 9.18553 8.50029 9.15341 8.50087C6.2987 8.55218 4 10.8828 4 13.75C4 15.151 4.54746 16.422 5.44215 17.3643C5.75613 17.6949 5.80666 18.1961 5.56498 18.5828L5.30425 19H8.89548Z"
							fill="currentColor"
						></path></svg
					>
					<span>Tailwind Border Utilities</span>
				</div>
				<div
					class="flex cursor-pointer flex-row gap-3 rounded-lg p-2 transition-colors duration-150
			ease-in-out hover:bg-slate-800"
				>
					<svg
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
						class="icon-sidebar text-token-text-secondary"
						><path
							fill-rule="evenodd"
							clip-rule="evenodd"
							d="M8.52242 6.53608C9.7871 4.41979 12.1019 3 14.75 3C18.7541 3 22 6.24594 22 10.25C22 11.9007 21.4474 13.4239 20.5183 14.6425L21.348 15.97C21.5407 16.2783 21.5509 16.6668 21.3746 16.9848C21.1984 17.3027 20.8635 17.5 20.5 17.5H15.4559C14.1865 19.5963 11.883 21 9.25 21C9.18896 21 9.12807 20.9992 9.06735 20.9977C9.04504 20.9992 9.02258 21 9 21H3.5C3.13647 21 2.80158 20.8027 2.62536 20.4848C2.44913 20.1668 2.45933 19.7783 2.652 19.47L3.48171 18.1425C2.55263 16.9239 2 15.4007 2 13.75C2 9.99151 4.85982 6.90116 8.52242 6.53608ZM10.8938 6.68714C14.106 7.43177 16.5 10.3113 16.5 13.75C16.5 14.3527 16.4262 14.939 16.2871 15.5H18.6958L18.435 15.0828C18.1933 14.6961 18.2439 14.1949 18.5579 13.8643C19.4525 12.922 20 11.651 20 10.25C20 7.3505 17.6495 5 14.75 5C13.2265 5 11.8535 5.64888 10.8938 6.68714ZM8.89548 19C8.94178 18.9953 8.98875 18.9938 9.03611 18.9957C9.107 18.9986 9.17831 19 9.25 19C11.3195 19 13.1112 17.8027 13.9668 16.0586C14.3079 15.363 14.5 14.5804 14.5 13.75C14.5 10.8505 12.1495 8.5 9.25 8.5C9.21772 8.5 9.18553 8.50029 9.15341 8.50087C6.2987 8.55218 4 10.8828 4 13.75C4 15.151 4.54746 16.422 5.44215 17.3643C5.75613 17.6949 5.80666 18.1961 5.56498 18.5828L5.30425 19H8.89548Z"
							fill="currentColor"
						></path></svg
					>
					<span>Tailwind Border Utilities</span>
				</div>
			</div>
			<div class="chats yesterday-chats flex flex-col gap-2">
				<span class="p-2">Yesterday</span>
				<div
					class="flex cursor-pointer flex-row gap-3 rounded-lg p-2 transition-colors duration-150
			ease-in-out hover:bg-slate-800"
				>
					<svg
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
						class="icon-sidebar text-token-text-secondary"
						><path
							fill-rule="evenodd"
							clip-rule="evenodd"
							d="M8.52242 6.53608C9.7871 4.41979 12.1019 3 14.75 3C18.7541 3 22 6.24594 22 10.25C22 11.9007 21.4474 13.4239 20.5183 14.6425L21.348 15.97C21.5407 16.2783 21.5509 16.6668 21.3746 16.9848C21.1984 17.3027 20.8635 17.5 20.5 17.5H15.4559C14.1865 19.5963 11.883 21 9.25 21C9.18896 21 9.12807 20.9992 9.06735 20.9977C9.04504 20.9992 9.02258 21 9 21H3.5C3.13647 21 2.80158 20.8027 2.62536 20.4848C2.44913 20.1668 2.45933 19.7783 2.652 19.47L3.48171 18.1425C2.55263 16.9239 2 15.4007 2 13.75C2 9.99151 4.85982 6.90116 8.52242 6.53608ZM10.8938 6.68714C14.106 7.43177 16.5 10.3113 16.5 13.75C16.5 14.3527 16.4262 14.939 16.2871 15.5H18.6958L18.435 15.0828C18.1933 14.6961 18.2439 14.1949 18.5579 13.8643C19.4525 12.922 20 11.651 20 10.25C20 7.3505 17.6495 5 14.75 5C13.2265 5 11.8535 5.64888 10.8938 6.68714ZM8.89548 19C8.94178 18.9953 8.98875 18.9938 9.03611 18.9957C9.107 18.9986 9.17831 19 9.25 19C11.3195 19 13.1112 17.8027 13.9668 16.0586C14.3079 15.363 14.5 14.5804 14.5 13.75C14.5 10.8505 12.1495 8.5 9.25 8.5C9.21772 8.5 9.18553 8.50029 9.15341 8.50087C6.2987 8.55218 4 10.8828 4 13.75C4 15.151 4.54746 16.422 5.44215 17.3643C5.75613 17.6949 5.80666 18.1961 5.56498 18.5828L5.30425 19H8.89548Z"
							fill="currentColor"
						></path></svg
					>
					<span>Tailwind Border Utilities</span>
				</div>
				<div
					class="flex cursor-pointer flex-row gap-3 rounded-lg p-2 transition-colors duration-150
			ease-in-out hover:bg-slate-800"
				>
					<svg
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
						class="icon-sidebar text-token-text-secondary"
						><path
							fill-rule="evenodd"
							clip-rule="evenodd"
							d="M8.52242 6.53608C9.7871 4.41979 12.1019 3 14.75 3C18.7541 3 22 6.24594 22 10.25C22 11.9007 21.4474 13.4239 20.5183 14.6425L21.348 15.97C21.5407 16.2783 21.5509 16.6668 21.3746 16.9848C21.1984 17.3027 20.8635 17.5 20.5 17.5H15.4559C14.1865 19.5963 11.883 21 9.25 21C9.18896 21 9.12807 20.9992 9.06735 20.9977C9.04504 20.9992 9.02258 21 9 21H3.5C3.13647 21 2.80158 20.8027 2.62536 20.4848C2.44913 20.1668 2.45933 19.7783 2.652 19.47L3.48171 18.1425C2.55263 16.9239 2 15.4007 2 13.75C2 9.99151 4.85982 6.90116 8.52242 6.53608ZM10.8938 6.68714C14.106 7.43177 16.5 10.3113 16.5 13.75C16.5 14.3527 16.4262 14.939 16.2871 15.5H18.6958L18.435 15.0828C18.1933 14.6961 18.2439 14.1949 18.5579 13.8643C19.4525 12.922 20 11.651 20 10.25C20 7.3505 17.6495 5 14.75 5C13.2265 5 11.8535 5.64888 10.8938 6.68714ZM8.89548 19C8.94178 18.9953 8.98875 18.9938 9.03611 18.9957C9.107 18.9986 9.17831 19 9.25 19C11.3195 19 13.1112 17.8027 13.9668 16.0586C14.3079 15.363 14.5 14.5804 14.5 13.75C14.5 10.8505 12.1495 8.5 9.25 8.5C9.21772 8.5 9.18553 8.50029 9.15341 8.50087C6.2987 8.55218 4 10.8828 4 13.75C4 15.151 4.54746 16.422 5.44215 17.3643C5.75613 17.6949 5.80666 18.1961 5.56498 18.5828L5.30425 19H8.89548Z"
							fill="currentColor"
						></path></svg
					>
					<span>Tailwind Border Utilities</span>
				</div>
				<div
					class="flex cursor-pointer flex-row gap-3 rounded-lg p-2 transition-colors duration-150
			ease-in-out hover:bg-slate-800"
				>
					<svg
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
						class="icon-sidebar text-token-text-secondary"
						><path
							fill-rule="evenodd"
							clip-rule="evenodd"
							d="M8.52242 6.53608C9.7871 4.41979 12.1019 3 14.75 3C18.7541 3 22 6.24594 22 10.25C22 11.9007 21.4474 13.4239 20.5183 14.6425L21.348 15.97C21.5407 16.2783 21.5509 16.6668 21.3746 16.9848C21.1984 17.3027 20.8635 17.5 20.5 17.5H15.4559C14.1865 19.5963 11.883 21 9.25 21C9.18896 21 9.12807 20.9992 9.06735 20.9977C9.04504 20.9992 9.02258 21 9 21H3.5C3.13647 21 2.80158 20.8027 2.62536 20.4848C2.44913 20.1668 2.45933 19.7783 2.652 19.47L3.48171 18.1425C2.55263 16.9239 2 15.4007 2 13.75C2 9.99151 4.85982 6.90116 8.52242 6.53608ZM10.8938 6.68714C14.106 7.43177 16.5 10.3113 16.5 13.75C16.5 14.3527 16.4262 14.939 16.2871 15.5H18.6958L18.435 15.0828C18.1933 14.6961 18.2439 14.1949 18.5579 13.8643C19.4525 12.922 20 11.651 20 10.25C20 7.3505 17.6495 5 14.75 5C13.2265 5 11.8535 5.64888 10.8938 6.68714ZM8.89548 19C8.94178 18.9953 8.98875 18.9938 9.03611 18.9957C9.107 18.9986 9.17831 19 9.25 19C11.3195 19 13.1112 17.8027 13.9668 16.0586C14.3079 15.363 14.5 14.5804 14.5 13.75C14.5 10.8505 12.1495 8.5 9.25 8.5C9.21772 8.5 9.18553 8.50029 9.15341 8.50087C6.2987 8.55218 4 10.8828 4 13.75C4 15.151 4.54746 16.422 5.44215 17.3643C5.75613 17.6949 5.80666 18.1961 5.56498 18.5828L5.30425 19H8.89548Z"
							fill="currentColor"
						></path></svg
					>
					<span>Tailwind Border Utilities</span>
				</div>
			</div>
		</div>
	</div>
</div>
<div class="relative z-[-1] min-h-0 min-w-0">
	<div
		class="scrollbar-custom h-full overflow-y-auto"
		use:snapScrollToBottom={messages.map((message) => message.content)}
		bind:this={chatContainer}
	>
		<div
			class="mx-auto flex h-full max-w-3xl flex-col gap-6 px-5 pt-6 sm:gap-8 xl:max-w-4xl xl:pt-10"
		>
			{#if assistant && !!messages.length}
				<a
					class="mx-auto flex items-center gap-1.5 rounded-full border border-gray-100 bg-gray-50 py-1 pl-1 pr-3 text-sm text-gray-800 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
					href="{base}/settings/assistants/{assistant._id}"
				>
					{#if assistant.avatar}
						<img
							src="{base}/settings/assistants/{assistant._id.toString()}/avatar.jpg?hash=${assistant.avatar}"
							alt="Avatar"
							class="size-5 rounded-full object-cover"
						/>
					{:else}
						<div
							class="flex size-6 items-center justify-center rounded-full bg-gray-300 font-bold uppercase text-gray-500"
						>
							{assistant.name[0]}
						</div>
					{/if}

					{assistant.name}
				</a>
			{:else if preprompt && preprompt != currentModel.preprompt}
				<SystemPromptModal preprompt={preprompt ?? ""} />
			{/if}

			{#if messages.length > 0}
				<div class="flex h-max flex-col gap-8 pb-52">
					{#each messages as message, idx (message.id)}
						<ChatMessage
							{loading}
							{message}
							alternatives={messagesAlternatives.find((a) => a.includes(message.id)) ?? []}
							isAuthor={!shared}
							readOnly={isReadOnly}
							isLast={idx === messages.length - 1}
							bind:editMsdgId
							on:retry
							on:vote
							on:continue
							on:showAlternateMsg
						/>
					{/each}
					{#if isReadOnly}
						<ModelSwitch {models} {currentModel} />
					{/if}
				</div>
			{:else if pending}
				<ChatMessage
					loading={true}
					message={{
						id: "0-0-0-0-0",
						content: "",
						from: "assistant",
						children: [],
					}}
					isAuthor={!shared}
					readOnly={isReadOnly}
				/>
			{:else if !assistant}
				<ChatIntroduction
					{currentModel}
					on:message={(ev) => {
						if (page.data.loginRequired) {
							ev.preventDefault();
							$loginModalOpen = true;
						} else {
							dispatch("message", ev.detail);
						}
					}}
				/>
			{:else}
				<AssistantIntroduction
					{models}
					{assistant}
					on:message={(ev) => {
						if (page.data.loginRequired) {
							ev.preventDefault();
							$loginModalOpen = true;
						} else {
							dispatch("message", ev.detail);
						}
					}}
				/>
			{/if}
		</div>

		<ScrollToPreviousBtn
			class="fixed right-4 max-md:bottom-[calc(50%+26px)] md:bottom-48 lg:right-10"
			scrollNode={chatContainer}
		/>

		<ScrollToBottomBtn
			class="fixed right-4 max-md:bottom-[calc(50%-26px)] md:bottom-36 lg:right-10"
			scrollNode={chatContainer}
		/>
	</div>
	<div
		class="dark:via-gray-80 pointer-events-none absolute inset-x-0 bottom-0 z-0 mx-auto flex w-full max-w-3xl flex-col items-center justify-center bg-gradient-to-t from-white via-white/80 to-white/0 px-3.5 py-4 dark:border-gray-800 dark:from-gray-900 dark:to-gray-900/0 max-md:border-t max-md:bg-white max-md:dark:bg-gray-900 sm:px-5 md:py-8 xl:max-w-4xl [&>*]:pointer-events-auto"
	>
		{#if sources?.length && !loading}
			<div
				in:fly|local={sources.length === 1 ? { y: -20, easing: cubicInOut } : undefined}
				class="flex flex-row flex-wrap justify-center gap-2.5 rounded-xl max-md:pb-3"
			>
				{#each sources as source, index}
					{#await source then src}
						<UploadedFile
							file={src}
							on:close={() => {
								files = files.filter((_, i) => i !== index);
							}}
						/>
					{/await}
				{/each}
			</div>
		{/if}

		<div class="w-full">
			<div class="flex w-full *:mb-3">
				{#if loading}
					<StopGeneratingBtn classNames="ml-auto" onClick={() => dispatch("stop")} />
				{:else if lastIsError}
					<RetryBtn
						classNames="ml-auto"
						onClick={() => {
							if (lastMessage && lastMessage.ancestors) {
								dispatch("retry", {
									id: lastMessage.id,
								});
							}
						}}
					/>
				{:else if messages && lastMessage && lastMessage.interrupted && !isReadOnly}
					<div class="ml-auto gap-2">
						<ContinueBtn
							onClick={() => {
								if (lastMessage && lastMessage.ancestors) {
									dispatch("continue", {
										id: lastMessage?.id,
									});
								}
							}}
						/>
					</div>
				{/if}
			</div>
			<form
				tabindex="-1"
				aria-label={isFileUploadEnabled ? "file dropzone" : undefined}
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class="relative flex w-full max-w-4xl flex-1 items-center rounded-xl border bg-gray-100 dark:border-gray-600 dark:bg-gray-700
            {isReadOnly ? 'opacity-30' : ''}"
			>
				{#if onDrag && isFileUploadEnabled}
					<FileDropzone bind:files bind:onDrag mimeTypes={activeMimeTypes} />
				{:else}
					<div
						class="flex w-full flex-1 rounded-xl border-none bg-transparent"
						class:paste-glow={pastedLongContent}
					>
						{#if lastIsError}
							<ChatInput value="Sorry, something went wrong. Please try again." disabled={true} />
						{:else}
							<ChatInput
								{assistant}
								placeholder={isReadOnly ? "This conversation is read-only." : "Ask anything"}
								{loading}
								bind:value={message}
								bind:files
								mimeTypes={activeMimeTypes}
								on:submit={handleSubmit}
								{onPaste}
								disabled={isReadOnly || lastIsError}
								modelHasTools={currentModel.tools}
								modelIsMultimodal={currentModel.multimodal}
							/>
						{/if}

						{#if loading}
							<button
								disabled
								class="btn absolute bottom-1 right-0.5 size-10 self-end rounded-lg bg-transparent text-gray-400"
							>
								<EosIconsLoading />
							</button>
						{:else}
							<button
								class="btn absolute bottom-2 right-2 size-7 self-end rounded-full border bg-white text-black shadow transition-none enabled:hover:bg-white enabled:hover:shadow-inner disabled:opacity-60 dark:border-gray-600 dark:bg-gray-900 dark:text-white dark:hover:enabled:bg-black"
								disabled={!message || isReadOnly}
								type="submit"
								aria-label="Send message"
								name="submit"
							>
								<svg
									width="1em"
									height="1em"
									viewBox="0 0 32 32"
									fill="none"
									xmlns="http://www.w3.org/2000/svg"
								>
									<path
										fill-rule="evenodd"
										clip-rule="evenodd"
										d="M17.0606 4.23197C16.4748 3.64618 15.525 3.64618 14.9393 4.23197L5.68412 13.4871C5.09833 14.0729 5.09833 15.0226 5.68412 15.6084C6.2699 16.1942 7.21965 16.1942 7.80544 15.6084L14.4999 8.91395V26.7074C14.4999 27.5359 15.1715 28.2074 15.9999 28.2074C16.8283 28.2074 17.4999 27.5359 17.4999 26.7074V8.91395L24.1944 15.6084C24.7802 16.1942 25.7299 16.1942 26.3157 15.6084C26.9015 15.0226 26.9015 14.0729 26.3157 13.4871L17.0606 4.23197Z"
										fill="currentColor"
									/>
								</svg>
							</button>
						{/if}
					</div>
				{/if}
			</form>
			<div
				class="mt-2 flex justify-between self-stretch px-1 text-xs text-gray-400/90 max-md:mb-2 max-sm:gap-2"
			>
				<p>
					Model:
					{#if !assistant}
						{#if models.find((m) => m.id === currentModel.id)}
							<a
								href="{base}/settings/{currentModel.id}"
								class="inline-flex items-center hover:underline"
								>{currentModel.displayName}<CarbonCaretDown class="text-xxs" /></a
							>
						{:else}
							<span class="inline-flex items-center line-through dark:border-gray-700">
								{currentModel.id}
							</span>
						{/if}
					{:else}
						{@const model = models.find((m) => m.id === assistant?.modelId)}
						{#if model}
							<a
								href="{base}/settings/assistants/{assistant._id}"
								class="inline-flex items-center border-b hover:text-gray-600 dark:border-gray-700 dark:hover:text-gray-300"
								>{model?.displayName}<CarbonCaretDown class="text-xxs" /></a
							>
						{:else}
							<span class="inline-flex items-center line-through dark:border-gray-700">
								{currentModel.id}
							</span>
						{/if}
					{/if}
					<span class="max-sm:hidden">·</span><br class="sm:hidden" /> Generated content may be inaccurate
					or false.
				</p>
				{#if messages.length}
					<button
						class="flex flex-none items-center hover:text-gray-400 max-sm:rounded-lg max-sm:bg-gray-50 max-sm:px-2.5 dark:max-sm:bg-gray-800"
						type="button"
						class:hover:underline={!isSharedRecently}
						onclick={onShare}
						disabled={isSharedRecently}
					>
						{#if isSharedRecently}
							<CarbonCheckmark class="text-[.6rem] sm:mr-1.5 sm:text-green-600" />
							<div class="text-green-600 max-sm:hidden">Link copied to clipboard</div>
						{:else}
							<CarbonExport class="sm:text-primary-500 text-[.6rem] sm:mr-1.5" />
							<div class="max-sm:hidden">Share this conversation</div>
						{/if}
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>

<style lang="postcss">
	.paste-glow {
		animation: glow 1s cubic-bezier(0.4, 0, 0.2, 1) forwards;
		will-change: box-shadow;
	}

	@keyframes glow {
		0% {
			box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.8);
		}
		50% {
			box-shadow: 0 0 20px 4px rgba(59, 130, 246, 0.6);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(59, 130, 246, 0);
		}
	}
	.chat-container::-webkit-scrollbar-thumb {
		background-color: #7775;
		border-radius: 0.5em;
	}

	.chat-container::-webkit-scrollbar-thumb:hover {
		background-color: #777;
	}

	.chat-container::-webkit-scrollbar {
		width: 10px;
	}

	.chat-container::-webkit-scrollbar-track {
		background-color: #5555;
		margin-block: 1.25em;
		border-radius: 0.5em;
	}
	.chat-container > div,
	.chats div {
	}
</style>
