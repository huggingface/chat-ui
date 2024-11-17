<script lang="ts">
	import "highlight.js/styles/atom-one-dark.css";
	import { createEventDispatcher, onDestroy, onMount } from "svelte";
	import { Editor, Extension, type Editor as EditorType } from "@tiptap/core";
	import { common, createLowlight } from "lowlight";
	import { Markdown } from "tiptap-markdown";
	import StarterKit from "@tiptap/starter-kit";
	import Placeholder from "@tiptap/extension-placeholder";
	import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";

	export let value = "";
	export let placeholder = "";
	export let disabled = false;
	export let minHeight = "1.5em";
	export let maxHeight = "auto";
	export let autofocus = false;

	const lowlight = createLowlight(common);

	/**
	 * Handles the creation of code blocks in the editor when a valid trigger sequence is detected.
	 * A valid trigger sequence consists of exactly three backticks optionally followed by a supported language identifier.
	 *
	 * Valid examples:
	 * - ```                (creates a code block with no language)
	 * - ```python          (creates a Python code block)
	 * - ```cpp             (creates a C++ code block)
	 *
	 * Invalid examples:
	 * - ``                 (too few backticks)
	 * - ````               (too many backticks)
	 * - ```invalidlang     (unsupported language)
	 *
	 * The function handles various edge cases:
	 * - Works after line breaks and formatting tags
	 * - Prevents nested code blocks
	 * - Validates language support via lowlight
	 *
	 * @param {EditorType} params.editor - The TipTap editor instance
	 * @returns {boolean} returns true if a code block was created, false otherwise
	 */
	const handleCodeBlockShortcut = ({ editor }: { editor: EditorType }): boolean => {
		const { from } = editor.state.selection;
		const doc = editor.state.doc;

		const resolvedPos = editor.state.doc.resolve(from);
		const currentElement = resolvedPos.parent.type.name;

		// check if codeblock is being opened from another codeblock
		if (currentElement === "codeBlock") {
			return false;
		}

		// get all text from the start of the editor's input up to the cursor
		const fullTextUpToCursor = doc.textBetween(0, from);

		// clean up the text: normalize line breaks and collapse multiple spaces
		const cleanText = fullTextUpToCursor.replace(/\s+/g, " ").trim();

		// look for the last occurrence of text that might be backticks
		const matches = cleanText.match(/`+/g);
		if (!matches) return false;

		// get the last set of backticks
		const lastBackticks = matches[matches.length - 1];

		if (lastBackticks.length !== 3) return false;

		const lastBackticksIndex = cleanText.lastIndexOf(lastBackticks);

		// get everything after the last three backticks
		const textAfterBackticks = cleanText.slice(lastBackticksIndex + 3);

		// get the language part if it exists
		const language = textAfterBackticks.trim() || null;

		// don't create a codeblock if language is not supported
		if (language && !lowlight.registered(language)) return false;

		const startPos = from - (cleanText.length - lastBackticksIndex);

		// consume the codeblock shortcut from the editor
		editor.commands.deleteRange({
			from: startPos,
			to: from,
		});

		editor
			.chain()
			.insertContent({ type: "paragraph" })
			.toggleNode("codeBlock", "paragraph", { language })
			.focus()
			.run();

		return true;
	};

	const dispatch = createEventDispatcher<{
		enterKey: { value: string };
		submit: void;
	}>();

	/**
	 * Handles keyboard events in the editor, specifically focusing on Enter key behavior.
	 *
	 * Key behaviors:
	 * - In code blocks: Allows default newline behavior
	 * - Outside code blocks:
	 *   - Enter: Dispatches 'submit' event if there's content
	 *   - Shift+Enter: Creates a new line
	 *
	 * @param {any} view - The editor view instance from TipTap
	 * @param {KeyboardEvent} event - The keyboard event
	 * @returns {boolean}
	 * - true if the event was handled and should be prevented
	 * - false if the event should be handled by default editor behavior
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function handleKeyDown(view: any, event: KeyboardEvent): boolean {
		if (event.key === "Enter") {
			const node = view.state.selection.$from.parent;

			if (node.type.name === "codeBlock") {
				// Let Tiptap handle the newline
				return false;
			}

			if (!event.shiftKey) {
				if (value.trim().length > 0) {
					value = editor.storage.markdown.getMarkdown();
					dispatch("enterKey", { value });

					// make sure to clear the input field after sending a message
					editor.commands.clearContent(true);
				}
				event.preventDefault();
				return true;
			}
		}
		return false;
	}

	// Allows creation of more than one code block in the editor
	const CustomCodeBlockExtension = Extension.create({
		name: "customCodeBlock",
		addKeyboardShortcuts() {
			return {
				Space: handleCodeBlockShortcut,
				"Shift-Enter": handleCodeBlockShortcut,
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

	const CustomCodeBlockLowlight = CodeBlockLowlight.extend({
		addKeyboardShortcuts() {
			// disable all shortcuts except arrow down
			return {
				ArrowDown: ({ editor }) => {
					const { state } = editor;
					const { selection } = state;
					const { $head } = selection;

					const currentNode = $head.node();
					if (currentNode.type.name === "codeBlock" && $head.pos === $head.end()) {
						return editor.commands.exitCode();
					}
					return false;
				},
			};
		},
		addInputRules() {
			// Disable default input rules
			return [];
		},
	}).configure({
		lowlight,
		HTMLAttributes: {
			class: "code-block",
		},
		languageClassPrefix: "language-",
		defaultLanguage: null,
	});

	const starterKitConfig = StarterKit.configure({
		// Disable these editor markdown shortcuts completely
		heading: false,
		bulletList: false,
		orderedList: false,
		listItem: false,
		horizontalRule: false,
		// We're using CodeBlockLowlight instead
		codeBlock: false,
	});

	const placeholderConfig = Placeholder.configure({
		placeholder,
		emptyEditorClass: "is-editor-empty",
	});

	onMount(() => {
		if (!editorContainer) return;

		editor = new Editor({
			element: editorContainer,
			extensions: [
				starterKitConfig,
				CustomCodeBlockLowlight,
				CustomCodeBlockExtension,
				// Displays placeholder text on the editor
				placeholderConfig,
				// Allows retrieving editor content as markdown syntax
				Markdown.configure({
					html: false,
					transformPastedText: true,
					transformCopiedText: true,
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
		background-color: #282c34;
		color: #abb2bf;
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
		background: #282c34;
		border-radius: 6px;
		border: 1px solid #d0d7de;
		padding: 16px;
	}

	:global(.ProseMirror .code-block) {
		background-color: #282c34;
		color: #abb2bf;
		font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
		font-size: 95%;
		line-height: 1.45;
		tab-size: 2;
		white-space: pre-wrap;
		word-break: break-word;
	}

	:global(.ProseMirror .code-block code) {
		padding: 0;
		background-color: transparent;
		border-radius: 0;
	}

	/*Optional: additional ways to further customize code highlights*/
	/* :global(.hljs-comment),
	:global(.hljs-quote) {
		color: #5c6370 !important;
		font-style: italic !important;
	} */

	/* :global(.hljs-doctag),
	:global(.hljs-keyword),
	:global(.hljs-formula) {
		color: #c678dd !important;
	}

	:global(.hljs-section),
	:global(.hljs-name),
	:global(.hljs-selector-tag),
	:global(.hljs-deletion),
	:global(.hljs-subst) {
		color: #e06c75 !important;
	}

	:global(.hljs-literal) {
		color: #56b6c2 !important;
	}

	:global(.hljs-string),
	:global(.hljs-regexp),
	:global(.hljs-addition),
	:global(.hljs-attribute),
	:global(.hljs-meta .hljs-string) {
		color: #98c379 !important;
	}

	:global(.hljs-attr),
	:global(.hljs-variable),
	:global(.hljs-template-variable),
	:global(.hljs-type),
	:global(.hljs-selector-class),
	:global(.hljs-selector-attr),
	:global(.hljs-selector-pseudo),
	:global(.hljs-number) {
		color: #d19a66 !important;
	}

	:global(.hljs-symbol),
	:global(.hljs-bullet),
	:global(.hljs-link),
	:global(.hljs-meta),
	:global(.hljs-selector-id),
	:global(.hljs-title) {
		color: #61aeee !important;
	}

	:global(.hljs-built_in),
	:global(.hljs-title.class_),
	:global(.hljs-class .hljs-title) {
		color: #e6c07b !important;
	}

	:global(.hljs-emphasis) {
		font-style: italic !important;
	}

	:global(.hljs-strong) {
		font-weight: bold !important;
	}

	:global(.hljs-link) {
		text-decoration: underline !important;
	} */
</style>
