import { describe, expect, it } from "vitest";
import { collectPaneItems, isPaneItemSelected } from "./paneItems";
import type { ArtifactRegistry } from "./artifacts";

const noArtifacts = { artifacts: new Map() } as unknown as ArtifactRegistry;

describe("space previews in the pane", () => {
	it("orders a preview with its message and selects it by URL", () => {
		const items = collectPaneItems(
			[{ id: "m1" }, { id: "m2" }],
			noArtifacts,
			[{ url: "https://x-trackio.hf.space", label: "x/trackio", messageId: "m2" }],
			[{ url: "https://u-p-dev.hf.space/", label: "u-p-dev", messageId: "m1" }]
		);
		expect(items.map((item) => item.kind)).toEqual(["space", "trackio"]);

		const [space] = items;
		expect(
			isPaneItemSelected(space, {
				view: "space",
				identifier: null,
				spaceUrl: "https://u-p-dev.hf.space/",
			})
		).toBe(true);
		expect(
			isPaneItemSelected(space, {
				view: "trackio",
				identifier: null,
				trackioUrl: "https://u-p-dev.hf.space/",
			})
		).toBe(false);
	});
});
