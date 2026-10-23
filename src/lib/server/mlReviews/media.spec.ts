import { describe, expect, it, vi } from "vitest";
import { parquetWriteBuffer } from "hyparquet-writer";
import type { MlReview } from "$lib/types/MlReview";

vi.mock("@huggingface/hub", async (importOriginal) => ({
	...(await importOriginal<typeof import("@huggingface/hub")>()),
	downloadFile: vi.fn(),
}));

const hub = await import("@huggingface/hub");
const { isViewerAssetUrl, reviewMedia, sniffMedia, viewerMediaSrc } = await import("./media");

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const bytes = (...parts: (number[] | string)[]) =>
	new Uint8Array(
		parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p))
	);

describe("review media", () => {
	it("types bytes by their signature and refuses what a page could run", () => {
		expect(sniffMedia(bytes(PNG), "image")).toBe("image/png");
		expect(sniffMedia(bytes([0xff, 0xd8, 0xff, 0xe0]), "image")).toBe("image/jpeg");
		expect(sniffMedia(bytes("RIFF", [0, 0, 0, 0], "WAVE"), "audio")).toBe("audio/wav");
		expect(sniffMedia(bytes([0, 0, 0, 0x20], "ftypisom"), "audio")).toBe("audio/mp4");
		expect(sniffMedia(bytes([0, 0, 0, 0x20], "ftypisom"), "video")).toBe("video/mp4");
		expect(sniffMedia(bytes(PNG), "audio")).toBeUndefined();
		expect(sniffMedia(bytes("<svg onload=alert(1)>"), "image")).toBeUndefined();
		expect(sniffMedia(bytes("<html><script>"), "video")).toBeUndefined();
	});

	it("follows only the viewer's own asset links", () => {
		expect(isViewerAssetUrl("https://datasets-server.huggingface.co/cached-assets/a.jpg")).toBe(
			true
		);
		expect(isViewerAssetUrl("https://cdn-lfs.hf.co/x")).toBe(true);
		expect(isViewerAssetUrl("http://datasets-server.huggingface.co/a.jpg")).toBe(false);
		expect(isViewerAssetUrl("https://huggingface.co.evil.example/a.jpg")).toBe(false);
		expect(isViewerAssetUrl("javascript:alert(1)")).toBe(false);
		expect(viewerMediaSrc({ src: "https://a", height: 1 })).toBe("https://a");
		expect(viewerMediaSrc([{ src: "https://b", type: "audio/wav" }])).toBe("https://b");
		expect(viewerMediaSrc(null)).toBeUndefined();
	});

	const viewerReview = {
		schema: { fields: [{ name: "picture", type: "image", column: "image" }] },
		records: [{ id: "5", values: {}, origin: { row: 5 }, media: ["picture"] }],
		source: {
			kind: "dataset",
			repo: "org/set",
			config: "default",
			split: "train",
			via: "viewer",
			sample: { method: "head", rows: 1, total: 10 },
		},
	} as unknown as MlReview;

	it("re-reads the row for a fresh link, with the user's token", async () => {
		const calls: { url: URL; auth: string | null }[] = [];
		const fetch = (async (input: string | URL, init?: RequestInit) => {
			calls.push({
				url: new URL(String(input)),
				auth: new Headers(init?.headers).get("authorization"),
			});
			return Response.json({
				features: [],
				rows: [
					{
						row_idx: 5,
						row: {
							image: {
								src: "https://datasets-server.huggingface.co/cached-assets/fresh.jpg?sig=1",
							},
						},
					},
				],
			});
		}) as typeof globalThis.fetch;
		const outcome = await reviewMedia(viewerReview, 0, "picture", { fetch, token: "hf_owner" });
		expect(outcome).toEqual({
			redirect: "https://datasets-server.huggingface.co/cached-assets/fresh.jpg?sig=1",
		});
		expect(calls[0].url.pathname).toBe("/rows");
		expect(calls[0].url.searchParams.get("offset")).toBe("5");
		expect(calls[0].url.searchParams.get("length")).toBe("1");
		expect(calls[0].auth).toBe("Bearer hf_owner");
	});

	it("refuses a link that leads off the viewer, and fields with no media", async () => {
		const fetch = (async () =>
			Response.json({
				rows: [{ row_idx: 5, row: { image: { src: "https://evil.example/x.jpg" } } }],
			})) as typeof globalThis.fetch;
		expect(await reviewMedia(viewerReview, 0, "picture", { fetch })).toMatchObject({ status: 502 });
		expect(await reviewMedia(viewerReview, 0, "other", { fetch })).toMatchObject({ status: 404 });
		expect(await reviewMedia(viewerReview, 3, "picture", { fetch })).toMatchObject({ status: 404 });
	});

	it("serves Parquet media bytes, reading the row group once for the whole grid", async () => {
		const rows = 6;
		const file = parquetWriteBuffer({
			columnData: [
				{
					name: "image",
					data: Array.from({ length: rows }, (_, i) => ({
						bytes: bytes(PNG, [i]),
						path: `${i}.png`,
					})),
				},
			],
			schema: [
				{ name: "root", num_children: 1 },
				{ name: "image", repetition_type: "OPTIONAL", num_children: 2 },
				{ name: "bytes", type: "BYTE_ARRAY", repetition_type: "OPTIONAL" },
				{ name: "path", type: "BYTE_ARRAY", converted_type: "UTF8", repetition_type: "OPTIONAL" },
			],
			rowGroupSize: 3,
		});
		let slices = 0;
		vi.mocked(hub.downloadFile).mockImplementation(async () => {
			const blob = new Blob([file]);
			return {
				size: blob.size,
				slice(start?: number, end?: number) {
					slices += 1;
					return blob.slice(start, end);
				},
			} as Blob;
		});
		const review = {
			schema: { fields: [{ name: "image", type: "image" }] },
			records: Array.from({ length: rows }, (_, i) => ({
				id: String(i),
				values: {},
				origin: { row: i, file: "data/train.parquet", fileRow: i },
				media: ["image"],
			})),
			source: {
				kind: "parquet",
				uri: "hf://buckets/org/b/data/train.parquet",
				files: ["data/train.parquet"],
				sample: { method: "head", rows, total: rows },
			},
		} as unknown as MlReview;

		const first = await reviewMedia(review, 4, "image", { token: "hf_owner" });
		expect(first).toEqual({ bytes: bytes(PNG, [4]), contentType: "image/png" });
		expect(vi.mocked(hub.downloadFile).mock.calls[0][0]).toMatchObject({
			repo: { type: "bucket", name: "org/b" },
			path: "data/train.parquet",
			accessToken: "hf_owner",
		});
		const after = slices;
		expect(await reviewMedia(review, 5, "image", { token: "hf_owner" })).toMatchObject({
			bytes: bytes(PNG, [5]),
		});
		expect(slices).toBe(after);
	});
});
