import { describe, expect, it } from "vitest";
import type { ReviewDestination } from "$lib/types/MlReview";
import {
	chosenDecision,
	exposesSource,
	publishOptions,
	resolveAudience,
	resolveSourceAudience,
} from "./publish";

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

	it("reads a whoami that fails or errors as unable to write", async () => {
		for (const who of [500, 401]) {
			const audience = await resolveAudience(dataset, {
				token: "hf_x",
				fetch: hub({ repo: { private: false }, who }),
			});
			expect(audience).toMatchObject({
				canWrite: false,
				label: "pull request on public dataset pngwn/gold",
			});
		}
		const broken = (async (input: string | URL) => {
			if (String(input).endsWith("/api/whoami-v2")) throw new TypeError("fetch failed");
			return Response.json({ private: false });
		}) as typeof fetch;
		expect((await resolveAudience(dataset, { token: "hf_x", fetch: broken })).canWrite).toBe(false);
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

	it("names who could already see the reviewed rows, and reads unknown as private", async () => {
		const seen = async (
			source: Parameters<typeof resolveSourceAudience>[0],
			repo: Parameters<typeof hub>[0]["repo"]
		) => resolveSourceAudience(source, { token: "hf_x", fetch: hub({ repo }) });
		const dataset = {
			kind: "dataset" as const,
			repo: "org/raw",
			config: "default",
			split: "train",
			via: "viewer" as const,
			sample: { method: "head" as const, rows: 1 },
		};
		expect(await seen(dataset, { private: false })).toEqual({
			visibility: "public",
			label: "rows from a public dataset org/raw",
		});
		expect((await seen(dataset, { private: false, gated: "auto" })).visibility).toBe("gated");
		expect((await seen(dataset, 401)).visibility).toBe("private");
		expect((await seen(dataset, 500)).visibility).toBe("unknown");
		const bucket = {
			kind: "parquet" as const,
			uri: "hf://buckets/org/raw/data",
			files: [],
			sample: { method: "head" as const, rows: 1 },
		};
		expect(await seen(bucket, { private: true })).toEqual({
			visibility: "private",
			label: "rows from a private bucket org/raw",
		});
		expect(
			await seen({ kind: "file", name: "rows.jsonl", version: 2 }, { private: false })
		).toEqual({
			visibility: "unknown",
			label: "rows from chat file rows.jsonl, not known to be public",
		});
		expect(
			(await seen({ kind: "sandbox", handle: "s", path: "/out/rows.csv" }, { private: false }))
				.label
		).toBe("rows from sandbox file /out/rows.csv, not known to be public");
	});

	it("flags only a source that is not public going to a public repo or pull request", () => {
		const to = (isPrivate?: boolean) => ({
			label: "x",
			exists: isPrivate !== undefined,
			...(isPrivate !== undefined ? { private: isPrivate } : {}),
			canWrite: true,
		});
		const from = (visibility: "public" | "private" | "gated" | "unknown") => ({
			visibility,
			label: "x",
		});
		expect(exposesSource(to(false), from("private"))).toBe(true);
		expect(exposesSource(to(false), from("gated"))).toBe(true);
		expect(exposesSource(to(false), from("unknown"))).toBe(true);
		expect(exposesSource(to(false), from("public"))).toBe(false);
		expect(exposesSource(to(true), from("private"))).toBe(false);
		// a repo that does not exist yet is created private
		expect(exposesSource(to(), from("private"))).toBe(false);
		expect(publishOptions(dataset, to(false), { skipFirst: true }).map((o) => o.value)).toEqual([
			"skip",
			"push",
			"pr",
		]);
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
