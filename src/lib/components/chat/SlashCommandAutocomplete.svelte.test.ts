import SlashCommandAutocomplete from "./SlashCommandAutocomplete.svelte";
import ChatInput from "./ChatInput.svelte";
import { render } from "vitest-browser-svelte";
import { userEvent } from "@vitest/browser/context";
import { describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { renderWithApp } from "$lib/components/__tests__/renderWithApp";
import { BTW_COMMAND, type SlashCommand } from "$lib/utils/slashCommands";

// read at import by the mcp store ChatInput pulls in, sveltekit only fills it in a running app
vi.mock("$env/dynamic/public", () => ({ env: {} }));

const commands: SlashCommand[] = [BTW_COMMAND, { name: "bench", description: "Run a benchmark" }];

describe("SlashCommandAutocomplete", () => {
	it("lists each command with its description and marks the active one", () => {
		const { container } = render(SlashCommandAutocomplete, {
			commands,
			activeIndex: 1,
			caretAnchor: { left: 12, bottom: 40 },
			onselect: () => {},
			onactivechange: () => {},
		});

		const options = container.querySelectorAll('[role="option"]');
		expect(options).toHaveLength(2);
		expect(options[0].textContent).toContain("/btw");
		expect(options[0].textContent).toContain(BTW_COMMAND.description);
		expect(options[1].id).toBe("slash-command-option-1");
		expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("/bench");
		const positioned = container.querySelector<HTMLElement>(".absolute");
		expect(positioned?.style.left).toBe("12px");
		expect(positioned?.style.bottom).toBe("40px");
	});

	it("returns the clicked command", () => {
		const onselect = vi.fn();
		const { container } = render(SlashCommandAutocomplete, {
			commands,
			activeIndex: 0,
			caretAnchor: { left: 0, bottom: 0 },
			onselect,
			onactivechange: () => {},
		});

		container.querySelectorAll<HTMLButtonElement>('[role="option"]')[1].click();
		expect(onselect).toHaveBeenCalledWith(commands[1]);
	});
});

describe("ChatInput slash commands", () => {
	function mount(slashCommands: SlashCommand[] = [BTW_COMMAND]) {
		const screen = renderWithApp(ChatInput, { slashCommands });
		const textarea = screen.container.querySelector("textarea");
		if (!textarea) throw new Error("no textarea");
		return { container: screen.container, textarea };
	}

	async function typeInto(textarea: HTMLTextAreaElement, text: string) {
		await userEvent.click(textarea);
		await userEvent.keyboard(text);
		await tick();
	}

	const listbox = (container: HTMLElement) => container.querySelector("#slash-command-listbox");

	it("offers /btw after a leading slash and Enter accepts it", async () => {
		const { container, textarea } = mount();
		await typeInto(textarea, "/");

		expect(listbox(container)?.textContent).toContain("/btw");
		expect(textarea.getAttribute("aria-expanded")).toBe("true");
		expect(textarea.getAttribute("aria-controls")).toBe("slash-command-listbox");
		expect(textarea.getAttribute("aria-activedescendant")).toBe("slash-command-option-0");

		await userEvent.keyboard("{Enter}");
		await tick();

		expect(textarea.value).toBe("/btw ");
		expect(textarea.selectionStart).toBe(5);
		expect(listbox(container)).toBeNull();
		expect(textarea.getAttribute("aria-expanded")).toBe("false");

		document.execCommand("undo");
		await tick();
		expect(textarea.value).toBe("/");
	});

	it("accepts with Tab and with a click", async () => {
		const tabbed = mount();
		await typeInto(tabbed.textarea, "/b");
		await userEvent.keyboard("{Tab}");
		await tick();
		expect(tabbed.textarea.value).toBe("/btw ");

		const clicked = mount();
		await typeInto(clicked.textarea, "/bt");
		listbox(clicked.container)?.querySelector<HTMLButtonElement>('[role="option"]')?.click();
		await tick();
		expect(clicked.textarea.value).toBe("/btw ");
	});

	it("closes on Escape until the query changes", async () => {
		const { container, textarea } = mount();
		await typeInto(textarea, "/b");
		expect(listbox(container)).not.toBeNull();

		await userEvent.keyboard("{Escape}");
		await tick();
		expect(listbox(container)).toBeNull();
		expect(textarea.value).toBe("/b");

		await userEvent.keyboard("t");
		await tick();
		expect(listbox(container)).not.toBeNull();
	});

	it("stays closed without commands, without a match, or away from index 0", async () => {
		const none = mount([]);
		await typeInto(none.textarea, "/");
		expect(listbox(none.container)).toBeNull();

		const nomatch = mount();
		await typeInto(nomatch.textarea, "/x");
		expect(listbox(nomatch.container)).toBeNull();

		const indented = mount();
		await typeInto(indented.textarea, " /");
		expect(listbox(indented.container)).toBeNull();

		const later = mount();
		await typeInto(later.textarea, "hi /");
		expect(listbox(later.container)).toBeNull();
	});

	it("closes once past the command word", async () => {
		const { container, textarea } = mount();
		await typeInto(textarea, "/btw hello");
		expect(listbox(container)).toBeNull();
		expect(textarea.getAttribute("aria-expanded")).toBe("false");
	});

	it("highlights a known command at index 0 only", async () => {
		const { container, textarea } = mount();
		await typeInto(textarea, "/btw hello");
		expect(container.querySelector(".command-token")?.textContent).toBe("/btw");

		const indented = mount();
		await typeInto(indented.textarea, " /btw hello");
		expect(indented.container.querySelector(".command-token")).toBeNull();

		const none = mount([]);
		await typeInto(none.textarea, "/btw hello");
		expect(none.container.querySelector(".command-token")).toBeNull();
	});

	it("keeps the highlighted command editable rather than atomic", async () => {
		const { container, textarea } = mount();
		await typeInto(textarea, "/btw");
		await userEvent.keyboard("{Backspace}");
		await tick();
		expect(textarea.value).toBe("/bt");
		expect(container.querySelector(".command-token")).toBeNull();
	});
});
