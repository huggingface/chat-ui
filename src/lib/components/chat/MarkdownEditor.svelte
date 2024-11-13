<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { Editor, Extension, type Editor as EditorType } from "@tiptap/core";
	import { common, createLowlight } from "lowlight";
	import StarterKit from "@tiptap/starter-kit";
	import Placeholder from "@tiptap/extension-placeholder";
	import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";

	export let value = "";
	export let placeholder = "";
	export let disabled = false;
	export let minHeight = "1.5em";
	export let maxHeight = "auto";
	export let autofocus = false;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	export let handleKeyDown: (view: any, event: KeyboardEvent) => boolean;

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

	let editor: EditorType;
	let editorContainer: HTMLElement;

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
			autofocus,
			onUpdate: ({ editor }) => {
				if (!disabled) {
					value = editor.getText();
				}
			},
			editorProps: {
				handleKeyDown,
				attributes: {
					class:
						"scrollbar-custom absolute top-0 m-0 h-full w-full resize-none scroll-p-3 overflow-x-hidden overflow-y-scroll p-3",
					style: `min-height: ${minHeight}; max-height: ${maxHeight};`,
				},
			},
		});
	});

	onDestroy(() => {
		if (editor) {
			editor.destroy();
		}
	});
</script>

<div class="relative min-w-0 flex-1">
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

	:global(.ProseMirror code) {
		background-color: #000000;
		color: #ffffff;
		border-radius: 4px;
		padding: 2px 4px;
		font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
		font-size: 95%;
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
