import PaperPagePill from "./PaperPagePill.svelte";
import { renderWithApp } from "$lib/components/__tests__/renderWithApp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writable } from "svelte/store";
import { agentMode } from "$lib/stores/agentMode.svelte";
import { mlAssistant } from "$lib/stores/mlAssistant.svelte";

const PAPERPAGE_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";

const render = (models: { id: string }[] = [{ id: PAPERPAGE_MODEL }, { id: "saved/model" }]) =>
	renderWithApp(
		PaperPagePill,
		{},
		{
			page: { data: { paperPageModel: PAPERPAGE_MODEL, models } },
			context: new Map<unknown, unknown>([
				["settings", writable({ activeModel: "saved/model", welcomeModalSeen: true })],
			]),
		}
	);

const control = (container: HTMLElement) => {
	const el = container.querySelector<HTMLElement>('[role="switch"]');
	if (!el) throw new Error("no switch");
	return el;
};

describe("PaperPagePill", () => {
	afterEach(() => {
		agentMode.clearPending();
		mlAssistant.reset();
	});

	it("starts the mode like the link does, preselecting its model", async () => {
		const { container } = render();
		expect(control(container).getAttribute("aria-label")).toBe("PaperPage Intern mode");

		control(container).click();

		expect(agentMode.pending).toBe("paperpage");
		expect(agentMode.modelFor("saved/model")).toBe(PAPERPAGE_MODEL);
		await vi.waitFor(() => expect(control(container).getAttribute("aria-checked")).toBe("true"));
	});

	it("keeps the saved model when the mode's model is not offered", () => {
		const { container } = render([{ id: "saved/model" }]);
		control(container).click();

		expect(agentMode.pending).toBe("paperpage");
		expect(agentMode.modelFor("saved/model")).toBe("saved/model");
	});

	it("switches ML Intern off, one mode per conversation", () => {
		mlAssistant.toggle(true);
		const { container } = render();
		control(container).click();

		expect(mlAssistant.enabled).toBe(false);
	});

	it("leaves the mode on the way off", async () => {
		const { container } = render();
		control(container).click();
		await vi.waitFor(() => expect(control(container).getAttribute("aria-checked")).toBe("true"));

		control(container).click();

		expect(agentMode.pending).toBeNull();
		expect(agentMode.preferredModel).toBeNull();
	});
});
