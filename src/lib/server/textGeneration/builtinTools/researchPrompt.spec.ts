import { describe, expect, it } from "vitest";
import { buildResearchSystemPrompt } from "./researchPrompt";

describe("buildResearchSystemPrompt", () => {
	it("advertises repo search only when the run has it", () => {
		const withSearch = buildResearchSystemPrompt(
			new Set(["hf_fs", "hub_repo_details", "hub_repo_search"])
		);
		expect(withSearch).toContain("`hub_repo_search`: find model/dataset/Space repos");
		expect(withSearch).toContain("never `hub_repo_search`");

		// The Hub's intern bouquet leaves it out; naming it would cost the
		// sub-agent a failed round to find that out.
		const bouquet = buildResearchSystemPrompt(new Set(["hf_fs", "hub_repo_details"]));
		expect(bouquet).not.toContain("hub_repo_search");
		expect(bouquet).toContain("`hf_fs` search over hf://models, hf://datasets or hf://spaces");
	});
});
