import { describe, expect, it } from "vitest";
import { DEFAULT_OWNER, parseRepo } from "./repoRef";

const ok = (repo: unknown, org?: unknown) => {
	const parsed = parseRepo(repo, org);
	if (!parsed.ok) throw new Error(parsed.message);
	return parsed.ref;
};

describe("parseRepo", () => {
	it("defaults a bare name to the grounding org", () => {
		expect(ok("trl")).toEqual({ owner: DEFAULT_OWNER, repo: "trl" });
	});

	it("accepts owner/repo", () => {
		expect(ok("pngwn/chat-ui")).toEqual({ owner: "pngwn", repo: "chat-ui" });
	});

	it("lets an explicit owner in `repo` win over a separate org", () => {
		// Following the advertised chain means pasting a hint of the form
		// {'repo': 'huggingface/trl'} into a tool that also takes `org`. The original
		// concatenated them into huggingface/huggingface/trl and 404'd every time.
		expect(ok("pngwn/chat-ui", "huggingface")).toEqual({ owner: "pngwn", repo: "chat-ui" });
	});

	it("uses `org` for a bare name", () => {
		expect(ok("chat-ui", "pngwn")).toEqual({ owner: "pngwn", repo: "chat-ui" });
	});

	it("accepts a pasted github.com URL", () => {
		expect(ok("https://github.com/huggingface/trl")).toEqual({
			owner: "huggingface",
			repo: "trl",
		});
		expect(ok("https://www.github.com/huggingface/trl.git")).toEqual({
			owner: "huggingface",
			repo: "trl",
		});
	});

	it("tolerates stray slashes", () => {
		expect(ok("/huggingface/trl/")).toEqual({ owner: "huggingface", repo: "trl" });
	});

	it("rejects a three-part path with the forms it does accept", () => {
		const parsed = parseRepo("huggingface/huggingface/trl");
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.message).toContain("'owner/repo'");
	});

	it("requires a repo", () => {
		expect(parseRepo(undefined).ok).toBe(false);
		expect(parseRepo("   ").ok).toBe(false);
		expect(parseRepo(42).ok).toBe(false);
	});

	it("falls back to the default owner when org is blank", () => {
		expect(ok("trl", "  ")).toEqual({ owner: DEFAULT_OWNER, repo: "trl" });
	});
});
