import { describe, expect, it } from "vitest";
import type { ReviewDestination } from "$lib/types/MlReview";
import { chosenDecision, publishOptions, resolveAudience } from "./publish";

const dataset: ReviewDestination = {
	repo: "pngwn/gold",
	type: "dataset",
	path: "a.parquet",
	pr: false,
};

function hub({
	repo,
	who = { name: "pngwn", orgs: [], auth: { accessToken: { role: "write" } } },
}: {
	repo: number | Record<string, unknown>;
	who?: Record<string, unknown> | number;
}): typeof fetch {
	return (async (input: string | URL) => {
		const url = String(input);
		const reply = url.endsWith("/api/whoami-v2") ? who : repo;
		return typeof reply === "number" ? new Response(null, { status: reply }) : Response.json(reply);
	}) as typeof fetch;
}

describe("the publish card", () => {
	it("names who will see the labels", async () => {
		const label = async (d: ReviewDestination, opts: Parameters<typeof hub>[0]) =>
			(await resolveAudience(d, { token: "hf_x", fetch: hub(opts) })).label;
		expect(await label(dataset, { repo: 404 })).toBe("new private dataset pngwn/gold");
		expect(await label(dataset, { repo: { private: false } })).toBe(
			"existing public dataset pngwn/gold"
		);
		expect(await label(dataset, { repo: { private: true } })).toBe(
			"existing private dataset pngwn/gold"
		);
		expect(await label({ ...dataset, pr: true }, { repo: { private: false } })).toBe(
			"pull request on public dataset pngwn/gold"
		);
		expect(
			await label(dataset, {
				repo: { private: false },
				who: { name: "someone", orgs: [], auth: { accessToken: { role: "write" } } },
			})
		).toBe("pull request on public dataset pngwn/gold");
		expect(await label({ ...dataset, type: "bucket" }, { repo: 404 })).toBe(
			"new private bucket pngwn/gold"
		);
		expect(
			await label(
				{ ...dataset, repo: "acme/gold" },
				{
					repo: { private: true },
					who: {
						name: "pngwn",
						orgs: [{ name: "acme", roleInOrg: "write" }],
						auth: { accessToken: { role: "write" } },
					},
				}
			)
		).toBe("existing private dataset acme/gold");
	});

	it("reads a read token or no sign in as unable to write", async () => {
		const read = await resolveAudience(dataset, {
			token: "hf_x",
			fetch: hub({
				repo: { private: false },
				who: { name: "pngwn", auth: { accessToken: { role: "read" } } },
			}),
		});
		expect(read.canWrite).toBe(false);
		expect(
			(await resolveAudience(dataset, { fetch: hub({ repo: { private: false } }) })).canWrite
		).toBe(false);
	});

	it("offers push only where the owner can write, and no pull request on a bucket", () => {
		const values = (d: ReviewDestination, canWrite: boolean) =>
			publishOptions(d, { label: "x", exists: true, canWrite }).map((o) => o.value);
		expect(values(dataset, true)).toEqual(["push", "pr", "skip"]);
		expect(values(dataset, false)).toEqual(["pr", "skip"]);
		expect(values({ ...dataset, pr: true }, true)).toEqual(["pr", "skip"]);
		expect(values({ ...dataset, type: "bucket" }, true)).toEqual(["push", "skip"]);
		expect(values({ ...dataset, type: "bucket" }, false)).toEqual(["skip"]);
	});

	it("reads anything but an accepted push or pull request as a skip", () => {
		expect(chosenDecision("accept", { publish: "push" })).toBe("push");
		expect(chosenDecision("accept", { publish: "pr" })).toBe("pr");
		expect(chosenDecision("accept", { publish: "skip" })).toBe("skip");
		expect(chosenDecision("accept", { publish: "something" })).toBe("skip");
		expect(chosenDecision("cancel", { publish: "push" })).toBe("skip");
		expect(chosenDecision("decline", undefined)).toBe("skip");
	});
});
