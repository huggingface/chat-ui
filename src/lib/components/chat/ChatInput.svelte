<script lang="ts">
	import { browser } from "$app/environment";
	import { createEventDispatcher, onMount, onDestroy } from "svelte";
	import { Editor, Extension, type Editor as EditorType } from "@tiptap/core";
	import { common, createLowlight } from "lowlight";
	import StarterKit from "@tiptap/starter-kit";
	import Placeholder from "@tiptap/extension-placeholder";
	import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";

	const lowlight = createLowlight(common);

	// Allows creation of more than one code block in the editor
	const CustomCodeBlockExtension = Extension.create({
		name: "customCodeBlock",
		addKeyboardShortcuts() {
			return {
				Space: ({ editor }) => {
					const { from } = editor.state.selection;
					const textBefore = editor.state.doc.textBetween(Math.max(0, from - 3), from, "\n");

					if (textBefore === "```") {
						editor.commands.deleteRange({
							from: from - 3,
							to: from,
						});

						// Separate new code block from previous entered data in the editor
						editor
							.chain()
							.insertContent({ type: "paragraph" })
							.toggleNode("codeBlock", "paragraph", { language: null })
							.focus()
							.run();

						return true;
					}

					return false;
				},
			};
		},
	});

	export let value = "";
	export let minRows = 1;
	export let maxRows: null | number = null;
	export let placeholder = "";
	export let disabled = false;

	let editor: EditorType;
	let editorContainer: HTMLElement;
	const dispatch = createEventDispatcher<{ submit: void }>();

	function isVirtualKeyboard(): boolean {
		if (!browser) return false;
		if (navigator.maxTouchPoints > 0) return true;
		if ("ontouchstart" in window) return true;
		const userAgent = navigator.userAgent.toLowerCase();
		return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
	}

	$: minHeight = `${minRows * 1.5}em`;
	$: maxHeight = maxRows ? `${maxRows * 1.5}em` : `auto`;

	$: if (editor) {
		editor.setEditable(!disabled);
		if (editor.getText() !== value) {
			editor.commands.setContent(value);
		}
	}

	onMount(() => {
		if (!editorContainer) return;

		editor = new Editor({
			element: editorContainer,
			extensions: [
				StarterKit.configure({
					// Disable these editor markdown shortcuts completely
					heading: false,
					bulletList: false,
					orderedList: false,
					listItem: false,
					horizontalRule: false,
					code: false,
					// We're using CodeBlockLowlight instead
					codeBlock: false,
				}),
				CodeBlockLowlight.configure({
					lowlight,
					HTMLAttributes: {
						class: "code-block",
					},
					// Exit conditions for code block
					exitOnArrowDown: true,
					exitOnTripleEnter: false,

					languageClassPrefix: "language-",
					defaultLanguage: null,
				}),
				CustomCodeBlockExtension,

				// Displays placeholder text on the editor
				Placeholder.configure({
					placeholder,
					emptyEditorClass: "is-editor-empty",
				}),
			],
			content: value,
			editable: !disabled,
			autofocus: !isVirtualKeyboard(),
			onUpdate: ({ editor }) => {
				if (!disabled) {
					value = editor.getText();
				}
			},
			editorProps: {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				handleKeyDown: (view: any, event: any) => {
					if (event.key === "Enter") {
						const node = view.state.selection.$from.parent;

						if (node.type.name === "codeBlock") {
							return false; // Let Tiptap handle the newline
						}

						if (!event.shiftKey) {
							const text = editor.getText();
							if (text.trim()) {
								dispatch("submit");
							}
							event.preventDefault();
							return true;
						}
					}
					return false;
				},
				attributes: {
					class:
						"scrollbar-custom absolute top-0 m-0 h-full w-full resize-none scroll-p-3 overflow-x-hidden overflow-y-scroll p-3",
					style: `min-height: ${minHeight}; max-height: ${maxHeight};`,
				},
			},
		});
	});

	// cleanup
	onDestroy(() => {
		if (editor) {
			editor.destroy();
		}
	});
</script>

<div class="relative min-w-0 flex-1" on:paste>
	<div bind:this={editorContainer} />
</div>

<style>
	:global(.ProseMirror) {
		font-family: inherit;
		box-sizing: border-box;
		line-height: 1.5;
		min-height: inherit;
		height: auto;
		outline: none !important;
	}

	:global(.ProseMirror p.is-editor-empty:first-child::before) {
		color: #adb5bd;
		content: attr(data-placeholder);
		float: left;
		height: 0;
		pointer-events: none;
	}

	:global(.ProseMirror pre) {
		margin: 0;
		background: #f6f8fa;
		border-radius: 6px;
		border: 1px solid #d0d7de;
		padding: 16px;
	}

	:global(.ProseMirror .code-block) {
		background-color: #000000;
		color: #ffffff;
		font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
		font-size: 95%;
		line-height: 1.45;
		tab-size: 2;
		white-space: pre-wrap;
		word-break: break-word;
	}

	/*additional customized editor code syntax highlighting*/
	:global(.hljs-comment),
	:global(.hljs-quote) {
		color: #1c871e;
	}

	/* :global(.hljs-keyword),
	:global(.hljs-selector-tag) {
		color: #b927c7;
	} */

	/* :global(.hljs-string),
	:global(.hljs-literal) {
		color: #de910b;
	} */

	/* :global(.hljs-title),
	:global(.hljs-function) {
		color: #c3bd16;
	} */
	/* 
	:global(.hljs-built_in),
	:global(.hljs-type) {
		color: #0880e2;
	} */

	/* :global(.hljs-tag),
	:global(.hljs-name) {
		color: #22863a;
	} */

	/* :global(.hljs-attr) {
		color: #c1c142;
	} */
</style>
