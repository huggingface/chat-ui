import MlAssistantPromo from "./MlAssistantPromo.svelte";
import { render } from "vitest-browser-svelte";
import { describe, expect, it, vi } from "vitest";

function mount(props: Partial<Parameters<typeof render<typeof MlAssistantPromo>>[1]> = {}) {
	return render(MlAssistantPromo, {
		visible: true,
		onask: () => {},
		ondismiss: () => {},
		...props,
	});
}

const find = (root: ParentNode, selector: string): HTMLElement => {
	const el = root.querySelector<HTMLElement>(selector);
	if (!el) throw new Error(`no element matching ${selector}`);
	return el;
};

describe("MlAssistantPromo", () => {
	it("offers the mode by name, with a note saying what the offer does", () => {
		const { container } = mount();

		expect(container.textContent).toContain("Ask in ML Intern");
		expect(container.textContent).toContain("— takes your question to a new chat with ML tools");
	});

	it("fires onask from the call to action", () => {
		const onask = vi.fn();
		const { container } = mount({ onask });

		const buttons = [...container.querySelectorAll("button")];
		const cta = buttons.find((b) => b.textContent?.includes("Ask in ML Intern"));
		cta?.click();

		expect(onask).toHaveBeenCalledOnce();
	});

	it("fires ondismiss from a labelled dismiss button", () => {
		const ondismiss = vi.fn();
		const { container } = mount({ ondismiss });

		find(container, 'button[aria-label="Dismiss"]').click();

		expect(ondismiss).toHaveBeenCalledOnce();
	});

	it("collapses out of the composer when hidden", () => {
		const shown = getComputedStyle(find(mount().container, ".ml-promo-collapse"));
		expect(shown.maxHeight).toBe("56px");
		expect(shown.opacity).toBe("1");

		const hidden = getComputedStyle(
			find(mount({ visible: false }).container, ".ml-promo-collapse")
		);
		expect(hidden.maxHeight).toBe("0px");
		expect(hidden.opacity).toBe("0");
	});
});
