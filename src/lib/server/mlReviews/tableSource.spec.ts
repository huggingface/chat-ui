import { beforeEach, describe, expect, it, vi } from "vitest";
import { parquetWriteBuffer } from "hyparquet-writer";
import type { DatasetColumn } from "./features";

vi.mock("@huggingface/hub", async (importOriginal) => ({
	...(await importOriginal<typeof import("@huggingface/hub")>()),
	downloadFile: vi.fn(),
	listFiles: vi.fn(),
	datasetInfo: vi.fn(async () => ({ sha: "c0ffee1234567890" })),
}));

const hub = await import("@huggingface/hub");
const { loadTable, parseTableInput } = await import("./tableSource");
type TableInput = import("./tableSource").TableInput;

const COLUMNS: DatasetColumn[] = [
	{ name: "Title", feature: { _type: "Value", dtype: "string" } },
	{ name: "label", feature: { _type: "ClassLabel", names: ["neg", "pos"] } },
	{ name: "image", feature: { _type: "Image" } },
];

interface FakeViewer {
	fetch: typeof fetch;
	calls: URL[];
}

function fakeViewer({
	total = 1_000_000,
	columns = COLUMNS,
	status,
	error = "",
	truncated = new Set<number>(),
	filtered = 40,
}: {
	total?: number;
	columns?: DatasetColumn[];
	status?: number;
	error?: string;
	truncated?: Set<number>;
	filtered?: number;
} = {}): FakeViewer {
	const calls: URL[] = [];
	const fake = (async (input: string | URL) => {
		const url = new URL(String(input));
		calls.push(url);
		if (status) return Response.json({ error }, { status });
		const endpoint = url.pathname.slice(1);
		if (endpoint === "splits") {
			return Response.json({
				splits: [
					{ config: "default", split: "train" },
					{ config: "default", split: "test" },
				],
			});
		}
		if (endpoint === "size") {
			return Response.json({ size: { splits: [{ split: "train", num_rows: total }] } });
		}
		const offset = Number(url.searchParams.get("offset"));
		const length = Number(url.searchParams.get("length"));
		const rows = Array.from({ length }, (_, i) => {
			const idx = endpoint === "rows" ? offset + i : 10_000 + offset + i;
			const cut = truncated.has(idx) && length > 1;
			return {
				row_idx: idx,
				row: {
					Title: cut ? "Tit" : `Title ${idx}`,
					label: idx % 2,
					image: { src: `https://datasets-server.huggingface.co/cached-assets/x/${idx}.jpg` },
				},
				truncated_cells: cut ? ["Title"] : [],
			};
		});
		return Response.json({
			features: columns.map((c, i) => ({ feature_idx: i, name: c.name, type: c.feature })),
			rows,
			num_rows_total: endpoint === "rows" ? total : filtered,
		});
	}) as typeof globalThis.fetch;
	return { fetch: fake, calls };
}

const input = (value: unknown) => parseTableInput("dataset", value) as TableInput;

describe("source.dataset through the dataset viewer", () => {
	it("draws a random sample in at most 20 calls, typed from the dataset's own features", async () => {
		const viewer = fakeViewer();
		const loaded = await loadTable(
			input({ repo: "org/set", sample: "random", rows: 50, seed: 42 }),
			{ access: { fetch: viewer.fetch, token: "hf_user" } }
		);
		if (!loaded.ok) throw new Error(loaded.error);

		const rowCalls = viewer.calls.filter((u) => u.pathname === "/rows");
		expect(rowCalls.length).toBeLessThanOrEqual(20);
		expect(loaded.records).toHaveLength(50);
		expect(loaded.fields).toEqual([
			{ name: "title", type: "text", column: "Title" },
			{ name: "label", type: "category" },
			{ name: "image", type: "image" },
		]);
		expect(loaded.media).toEqual(["image"]);
		const first = loaded.records[0];
		const row = loaded.origins[0].row ?? -1;
		expect(first.id).toBe(String(row));
		expect(first.label).toBe(row % 2 ? "pos" : "neg");
		expect(first).not.toHaveProperty("image");
		expect(loaded.mediaLinks?.[0]).toEqual({
			image: `https://datasets-server.huggingface.co/cached-assets/x/${row}.jpg`,
		});
		expect(loaded.mediaLinks).toHaveLength(50);
		const rows = loaded.origins.map((o) => o.row ?? -1);
		expect(Math.max(...rows)).toBeGreaterThan(900_000);
		expect(loaded.source).toMatchObject({
			kind: "dataset",
			repo: "org/set",
			config: "default",
			split: "train",
			revision: "c0ffee1234567890",
			via: "viewer",
			sample: { method: "random", rows: 50, total: 1_000_000, seed: 42 },
		});
	});

	it("fetches random windows in parallel, so twenty fit the viewer budget", async () => {
		const viewer = fakeViewer();
		let inFlight = 0;
		let most = 0;
		const slow = (async (url: string | URL, init?: RequestInit) => {
			if (!new URL(String(url)).pathname.startsWith("/rows")) return viewer.fetch(url, init);
			inFlight += 1;
			most = Math.max(most, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 300));
			inFlight -= 1;
			return viewer.fetch(url, init);
		}) as typeof fetch;
		const started = performance.now();
		const loaded = await loadTable(
			input({ repo: "org/set", sample: "random", rows: 20, seed: 4 }),
			{ access: { fetch: slow } }
		);
		if (!loaded.ok) throw new Error(loaded.error);
		expect(loaded.records).toHaveLength(20);
		expect(loaded.source).toMatchObject({ via: "viewer", sample: { windows: 20 } });
		expect(most).toBeGreaterThanOrEqual(6);
		expect(performance.now() - started).toBeLessThan(2_500);
	});

	it("sends the user's token on every viewer call", async () => {
		const seen: (string | null)[] = [];
		const viewer = fakeViewer();
		const fetch = (async (url: string | URL, init?: RequestInit) => {
			seen.push(new Headers(init?.headers).get("authorization"));
			return viewer.fetch(url, init);
		}) as typeof globalThis.fetch;
		await loadTable(input({ repo: "org/private", rows: 5 }), {
			access: { fetch, token: "hf_user" },
		});
		expect(seen.length).toBeGreaterThan(0);
		expect(seen.every((h) => h === "Bearer hf_user")).toBe(true);
	});

	it("reads declared fields from their columns and the id from id_field", async () => {
		const viewer = fakeViewer();
		const loaded = await loadTable(input({ repo: "org/set", rows: 3, offset: 10 }), {
			fields: [{ name: "headline", type: "markdown", column: "Title" }],
			idField: "Title",
			access: { fetch: viewer.fetch },
		});
		if (!loaded.ok) throw new Error(loaded.error);
		expect(loaded.records).toEqual([
			{ Title: "Title 10", headline: "Title 10" },
			{ Title: "Title 11", headline: "Title 11" },
			{ Title: "Title 12", headline: "Title 12" },
		]);
		expect(loaded.source).toMatchObject({ sample: { method: "head", offset: 10 } });
	});

	it("names the columns that exist when a field reads one that does not", async () => {
		const loaded = await loadTable(input({ repo: "org/set", rows: 3 }), {
			fields: [{ name: "body", type: "text" }],
			access: { fetch: fakeViewer().fetch },
		});
		expect(loaded).toEqual({
			ok: false,
			error: expect.stringMatching(/field body reads column "body".*Title, label, image/),
		});
	});

	it("refuses an image column declared as text, and any other split", async () => {
		const asText = await loadTable(input({ repo: "org/set", rows: 3 }), {
			fields: [{ name: "image", type: "text" }],
			access: { fetch: fakeViewer().fetch },
		});
		expect(asText).toMatchObject({
			ok: false,
			error: expect.stringContaining("declare field image as image"),
		});
		const split = await loadTable(input({ repo: "org/set", split: "validation" }), {
			access: { fetch: fakeViewer().fetch },
		});
		expect(split).toMatchObject({ ok: false, error: expect.stringContaining("train, test") });
	});

	it("reads a row the page cut short again on its own", async () => {
		const viewer = fakeViewer({ truncated: new Set([1]) });
		const loaded = await loadTable(input({ repo: "org/set", rows: 3 }), {
			access: { fetch: viewer.fetch },
		});
		if (!loaded.ok) throw new Error(loaded.error);
		expect(loaded.records[1].title).toBe("Title 1");
	});

	it("samples from a where filter by its own row count", async () => {
		const viewer = fakeViewer({ filtered: 40 });
		const loaded = await loadTable(
			input({ repo: "org/set", where: '"label" = 1', sample: "random", rows: 10, seed: 1 }),
			{ access: { fetch: viewer.fetch } }
		);
		if (!loaded.ok) throw new Error(loaded.error);
		const filters = viewer.calls.filter((u) => u.pathname === "/filter");
		expect(filters.length).toBeGreaterThan(1);
		expect(filters.every((u) => u.searchParams.get("where") === '"label" = 1')).toBe(true);
		expect(viewer.calls.some((u) => u.pathname === "/rows")).toBe(false);
		expect(loaded.source).toMatchObject({ sample: { where: '"label" = 1', total: 40 } });
		expect(loaded.origins.every((o) => (o.row ?? 0) >= 10_000)).toBe(true);
	});

	it("checks the sampling keys before any read", () => {
		expect(parseTableInput("dataset", { repo: "bad" })).toMatchObject({
			error: expect.stringContaining("org/name"),
		});
		expect(parseTableInput("dataset", { repo: "a/b", rows: 501 })).toMatchObject({
			error: expect.stringContaining("1 to 500"),
		});
		expect(parseTableInput("dataset", { repo: "a/b", sample: "random", offset: 3 })).toMatchObject({
			error: expect.stringContaining("seed"),
		});
		expect(parseTableInput("dataset", { repo: "a/b", where: "x", query: "y" })).toMatchObject({
			error: expect.stringContaining("not both"),
		});
		expect(
			parseTableInput("parquet", { uri: "hf://datasets/a/b/x.parquet", where: "x" })
		).toMatchObject({ error: expect.stringContaining("source.dataset") });
		expect(parseTableInput("parquet", "hf://models/a/b/x.parquet")).toMatchObject({
			error: expect.any(String),
		});
		expect(parseTableInput("parquet", "hf://buckets/a/b/data/")).toMatchObject({
			parquet: { uri: "hf://buckets/a/b/data/" },
		});
	});
});

const HF_META = {
	key: "huggingface",
	value: JSON.stringify({
		info: {
			features: {
				text: { _type: "Value", dtype: "string" },
				label: { _type: "ClassLabel", names: ["neg", "pos"] },
			},
		},
	}),
};

/** distinct text, so the file does not compress below the size hyparquet reads whole */
const noise = (i: number) =>
	Array.from({ length: 24 }, (_, j) => ((i * 7919 + j * 104729) % 1e8).toString(36)).join(" ");

function textParquet(rows: number, rowGroupSize: number): ArrayBuffer {
	return parquetWriteBuffer({
		columnData: [
			{
				name: "text",
				data: Array.from({ length: rows }, (_, i) => `row ${i} ${noise(i)}`),
				type: "STRING",
			},
			{ name: "label", data: Array.from({ length: rows }, (_, i) => i % 2), type: "INT32" },
		],
		rowGroupSize,
		codec: "UNCOMPRESSED",
		kvMetadata: [HF_META],
	});
}

function imageParquet(rows: number, rowGroupSize: number, imageBytes: number): ArrayBuffer {
	const png = new Uint8Array(imageBytes);
	png.set([0x89, 0x50, 0x4e, 0x47]);
	for (let i = 4; i < png.length; i += 1) png[i] = (i * 2654435761) % 251;
	return parquetWriteBuffer({
		columnData: [
			{ name: "id", data: Array.from({ length: rows }, (_, i) => i) },
			{
				name: "image",
				// distinct, or the writer keeps one copy in a dictionary
				data: Array.from({ length: rows }, (_, i) => {
					const bytes = png.slice();
					bytes[4] = i;
					return { bytes, path: `${i}.png` };
				}),
			},
		],
		schema: [
			{ name: "root", num_children: 2 },
			{ name: "id", type: "INT32", repetition_type: "REQUIRED" },
			{ name: "image", repetition_type: "OPTIONAL", num_children: 2 },
			{ name: "bytes", type: "BYTE_ARRAY", repetition_type: "OPTIONAL" },
			{ name: "path", type: "BYTE_ARRAY", converted_type: "UTF8", repetition_type: "OPTIONAL" },
		],
		rowGroupSize,
		codec: "UNCOMPRESSED",
	});
}

type Tree = Record<string, Record<string, ArrayBuffer | string>>;

/** lazy blobs that count what is sliced out of them, per revision, as range reads would */
function served(tree: Tree | Record<string, ArrayBuffer | string>) {
	const byRevision: Tree = Object.values(tree).every(
		(v) => typeof v === "object" && !(v instanceof ArrayBuffer)
	)
		? (tree as Tree)
		: { main: tree as Record<string, ArrayBuffer | string> };
	const read: Record<string, number> = {};
	const files = (revision?: string) => byRevision[decodeURIComponent(revision ?? "main")] ?? {};
	vi.mocked(hub.downloadFile).mockImplementation(async ({ path, revision }) => {
		const content = files(revision)[path];
		if (content === undefined) return null;
		const blob = new Blob([content]);
		return {
			size: blob.size,
			slice(start?: number, end?: number) {
				read[path] = (read[path] ?? 0) + ((end ?? blob.size) - (start ?? 0));
				return blob.slice(start, end);
			},
		} as Blob;
	});
	vi.mocked(hub.listFiles).mockImplementation(async function* ({ path = "", recursive, revision }) {
		const prefix = path ? `${path.replace(/\/$/, "")}/` : "";
		const folders = new Set<string>();
		for (const [file, content] of Object.entries(files(revision))) {
			if (!file.startsWith(prefix)) continue;
			const rest = file.slice(prefix.length);
			if (!recursive && rest.includes("/")) {
				const folder = `${prefix}${rest.split("/")[0]}`;
				if (!folders.has(folder)) yield { type: "directory" as const, path: folder, size: 0 };
				folders.add(folder);
				continue;
			}
			yield { type: "file" as const, path: file, size: new Blob([content]).size };
		}
	});
	return read;
}

const parquet = (value: unknown) => parseTableInput("parquet", value) as TableInput;

describe("source.parquet through range reads", () => {
	beforeEach(() => {
		vi.mocked(hub.downloadFile).mockReset();
	});

	it("reads only the row groups that hold the rows, typed from the file's features", async () => {
		const file = textParquet(10_000, 500);
		const read = served({ "data/train.parquet": file });
		const loaded = await loadTable(
			parquet({ uri: "hf://datasets/org/set/data/train.parquet", rows: 20, offset: 5_000 }),
			{ access: {} }
		);
		if (!loaded.ok) throw new Error(loaded.error);
		expect(loaded.records.map((r) => r.id)).toEqual(
			Array.from({ length: 20 }, (_, i) => String(5_000 + i))
		);
		expect(loaded.records[1].label).toBe("pos");
		expect(loaded.origins[0]).toEqual({ row: 5_000, file: "data/train.parquet", fileRow: 5_000 });
		expect(read["data/train.parquet"]).toBeLessThan(file.byteLength / 5);
	});

	it("draws a random sample inside a few seeded row groups across the files of a folder", async () => {
		served({
			"data/a.parquet": textParquet(1_000, 100),
			"data/b.parquet": textParquet(1_000, 100),
		});
		const draw = () =>
			loadTable(
				parquet({ uri: "hf://buckets/org/bucket/data", sample: "random", rows: 40, seed: 5 }),
				{
					access: {},
				}
			);
		const loaded = await draw();
		if (!loaded.ok) throw new Error(loaded.error);
		expect(loaded.records).toHaveLength(40);
		expect(loaded.source).toMatchObject({
			kind: "parquet",
			files: ["data/a.parquet", "data/b.parquet"],
			sample: { method: "random", total: 2_000, seed: 5, groups: 5 },
		});
		const groups = new Set(
			loaded.origins.map((o) => `${o.file}#${Math.floor((o.fileRow ?? 0) / 100)}`)
		);
		expect(groups.size).toBe(5);
		expect(new Set(loaded.origins.map((o) => o.row)).size).toBe(40);
		expect(vi.mocked(hub.downloadFile).mock.calls[0][0].repo).toEqual({
			type: "bucket",
			name: "org/bucket",
		});
		const again = await draw();
		if (!again.ok) throw new Error(again.error);
		expect(again.origins).toEqual(loaded.origins);
	});

	it("keeps media out of the records and the row groups it reads under 64 MB", async () => {
		served({ "img.parquet": imageParquet(20, 10, 4 * 1024 * 1024) });
		const head = await loadTable(parquet({ uri: "hf://datasets/org/img/img.parquet", rows: 5 }), {
			access: {},
		});
		if (!head.ok) throw new Error(head.error);
		expect(head.media).toEqual(["image"]);
		expect(head.fields).toEqual([{ name: "image", type: "image" }]);
		expect(head.records[0]).toEqual({ id: "0" });

		const random = await loadTable(
			parquet({ uri: "hf://datasets/org/img/img.parquet", sample: "random", rows: 20, seed: 1 }),
			{ access: {} }
		);
		if (!random.ok) throw new Error(random.error);
		expect(random.records).toHaveLength(10);
		expect(random.source).toMatchObject({ sample: { groups: 1 } });
	});

	it("refuses when even one row group is past the 64 MB", async () => {
		served({ "img.parquet": imageParquet(20, 20, 4 * 1024 * 1024) });
		const loaded = await loadTable(
			parquet({ uri: "hf://datasets/org/img/img.parquet", sample: "random", rows: 5, seed: 1 }),
			{ access: {} }
		);
		expect(loaded).toMatchObject({
			ok: false,
			error: expect.stringMatching(/about 81 MB.*past the 64 MB/),
		});
	});
});

/** four rows written with zstd, the codec hyparquet alone cannot read; zlib on node 20 cannot write it */
const ZSTD_PARQUET =
	"UEFSMRUGFSwVPlwVCBUAFQgVABUEFQAAAAMPKLUv/SAUoQAAAQAAAGEBAAAAYgEAAABjAQAAAGQVBhWIARWaAVwVCBUAFQgVABUEFQAAAAMPKLUv/SBCEQIAEAAAAFRoZSBza3kgaXMgZ3JlZW4MAAAAV2F0ZXIgaXMgd2V0DAAAAEZpcmUgaXMgY29sZAoAAABJY2UgaXMgaG90FQQZPEgEcm9vdBUEABUMJQIYAmlkJQAAFQwlAhgFY2xhaW0lAAAWCBkcGSwmCBwVDBkVABkYAmlkFQwWCBZoFmgmCDw2ACgBZBgBYQAZHBUGFQAVAgAAACZwHBUMGRUAGRgFY2xhaW0VDBYIFsgBFsgBJnA8NgAoDFdhdGVyIGlzIHdldBgMRmlyZSBpcyBjb2xkABkcFQYVABUCAAAAFrACFggAKAloeXBhcnF1ZXQAsQAAAFBBUjE=";

/** a codec nothing here can decode, written with a pass-through so the file is otherwise valid */
const lzoParquet = () =>
	parquetWriteBuffer({
		columnData: [{ name: "text", data: ["a", "b"], type: "STRING" }],
		codec: "LZO",
		compressors: { LZO: (bytes: Uint8Array) => bytes },
	});

const jsonl = (n: number) =>
	Array.from({ length: n }, (_, i) =>
		JSON.stringify({ id: `r${i}`, prompt: `Prompt ${i} ${noise(i)}`, score: i / 10 })
	).join("\n") + "\n";

describe("source.dataset without the viewer", () => {
	const down = (async () => {
		throw new TypeError("fetch failed");
	}) as typeof fetch;

	beforeEach(() => {
		vi.mocked(hub.downloadFile).mockReset();
		vi.mocked(hub.listFiles).mockReset();
	});

	it("reads the Parquet files at the requested revision and says why", async () => {
		served({
			"data/train-0.parquet": textParquet(100, 50),
			"data/test-0.parquet": textParquet(10, 10),
		});
		const loaded = await loadTable(input({ repo: "org/new", rows: 5 }), {
			access: { fetch: down },
		});
		if (!loaded.ok) throw new Error(loaded.error);
		expect(loaded.source).toMatchObject({
			kind: "dataset",
			via: "parquet",
			revision: "c0ffee1234567890",
			files: ["data/train-0.parquet"],
			viewerError: "the dataset viewer could not be reached",
		});
	});

	it("falls back when the viewer is not ready, rate limited, or asked for another revision", async () => {
		served({ "data/train-0.parquet": textParquet(100, 50) });
		for (const viewer of [
			fakeViewer({ status: 500, error: "The response is not ready yet. Please retry later." }),
			fakeViewer({ status: 429 }),
		]) {
			const loaded = await loadTable(input({ repo: "org/new", rows: 5 }), {
				access: { fetch: viewer.fetch },
			});
			expect(loaded.ok ? loaded.source : loaded.error).toMatchObject({ via: "parquet" });
			expect(viewer.calls).toHaveLength(1);
		}
		served({ "v1.0": { "data/train-0.parquet": textParquet(100, 50) } });
		const viewer = fakeViewer();
		const pinned = await loadTable(input({ repo: "org/new", rows: 5, revision: "v1.0" }), {
			access: { fetch: viewer.fetch },
		});
		expect(pinned).toMatchObject({ ok: true, source: { via: "parquet" } });
		expect(viewer.calls).toHaveLength(0);
		expect(vi.mocked(hub.downloadFile).mock.calls.at(-1)?.[0]).toMatchObject({ revision: "v1.0" });
	});

	it("reads the viewer's conversion branch when the repo has no Parquet, and flags a partial one", async () => {
		served({
			main: { "data/train.json.gz": "x" },
			"refs/convert/parquet": {
				"en/partial-train/0000.parquet": textParquet(300, 100),
				"en/partial-train/0001.parquet": textParquet(300, 100),
				"en/validation/0000.parquet": textParquet(10, 10),
			},
		});
		const loaded = await loadTable(
			input({ repo: "org/big", config: "en", sample: "random", rows: 12, seed: 2 }),
			{ access: { fetch: down } }
		);
		if (!loaded.ok) throw new Error(loaded.error);
		expect(loaded.source).toMatchObject({
			via: "converted",
			revision: "refs/convert/parquet",
			config: "en",
			split: "train",
			partial: true,
			files: ["en/partial-train/0000.parquet", "en/partial-train/0001.parquet"],
			sample: { total: 600, groups: 5 },
		});
	});

	it("samples JSONL lines by range reads, random marked approximate", async () => {
		const read = served({ "train.jsonl": jsonl(2_000) });
		const head = await loadTable(input({ repo: "org/lines", rows: 3 }), {
			access: { fetch: down },
		});
		if (!head.ok) throw new Error(head.error);
		expect(head.records.map((r) => r.id)).toEqual(["r0", "r1", "r2"]);
		expect(head.fields).toEqual([
			{ name: "prompt", type: "text" },
			{ name: "score", type: "number" },
		]);
		expect(head.origins[1]).toMatchObject({ row: 1, fileRow: 1, file: "train.jsonl" });
		expect(read["train.jsonl"]).toBeLessThan(64 * 1024);

		const random = await loadTable(
			input({ repo: "org/lines", sample: "random", rows: 40, seed: 9 }),
			{ access: { fetch: down } }
		);
		if (!random.ok) throw new Error(random.error);
		expect(random.records).toHaveLength(40);
		expect(new Set(random.records.map((r) => r.id)).size).toBe(40);
		expect(random.origins.every((o) => o.row === undefined && o.byte !== undefined)).toBe(true);
		expect(random.source).toMatchObject({
			via: "jsonl",
			sample: { approximate: true, windows: 20, bytes: new Blob([jsonl(2_000)]).size },
		});
		const ids = random.records.map((r) => Number(String(r.id).slice(1)));
		expect(Math.max(...ids)).toBeGreaterThan(1_800);
	});

	it("reads a CSV head whose quoted cells hold newlines", async () => {
		served({ "data/train.csv": 'id,body,stars\n1,"line one\nline two",5\n2,plain,3\n' });
		const loaded = await loadTable(input({ repo: "org/csv", rows: 5 }), {
			fields: [
				{ name: "body", type: "markdown" },
				{ name: "stars", type: "number" },
			],
			access: { fetch: down },
		});
		if (!loaded.ok) throw new Error(loaded.error);
		expect(loaded.records).toEqual([
			{ id: "1", body: "line one\nline two", stars: 5 },
			{ id: "2", body: "plain", stars: 3 },
		]);
		expect(loaded.source).toMatchObject({ via: "csv" });
	});

	it("reads a ZSTD Parquet file, as most dataset files are", async () => {
		served({ "data/train-0.parquet": Uint8Array.from(Buffer.from(ZSTD_PARQUET, "base64")).buffer });
		const loaded = await loadTable(input({ repo: "org/zstd", rows: 10 }), {
			access: { fetch: down },
		});
		if (!loaded.ok) throw new Error(loaded.error);
		expect(loaded.records.map((r) => r.claim)).toEqual([
			"The sky is green",
			"Water is wet",
			"Fire is cold",
			"Ice is hot",
		]);
	});

	it("falls past a file it cannot decode to the next path", async () => {
		served({
			main: { "data/train-0.parquet": lzoParquet() },
			"refs/convert/parquet": { "default/train/0000.parquet": textParquet(30, 10) },
		});
		const loaded = await loadTable(input({ repo: "org/odd", rows: 3 }), {
			access: { fetch: down },
		});
		if (!loaded.ok) throw new Error(loaded.error);
		expect(loaded.source).toMatchObject({ via: "converted", revision: "refs/convert/parquet" });
	});

	it("names why each path did not serve when none can", async () => {
		served({ main: { "data/train-0.parquet": lzoParquet() }, "refs/convert/parquet": {} });
		const loaded = await loadTable(input({ repo: "org/odd", rows: 3 }), {
			access: { fetch: down },
		});
		expect(loaded.ok).toBe(false);
		const error = loaded.ok ? "" : loaded.error;
		expect(error).toContain("Tried, in order:");
		expect(error).toContain("- dataset viewer: the dataset viewer could not be reached");
		expect(error).toMatch(/- Parquet files at main: .*unsupported compression codec: LZO/);
		expect(error).toContain("- refs/convert/parquet: no conversion for this split");
		expect(error).toContain("- JSONL or CSV files at main: none");
		expect(error).toContain("pass source.sandbox or source.hub; do not wait for the viewer");
	});

	it("keeps a url column declared as an image, which is not stored media", async () => {
		served({
			"train.jsonl": `${JSON.stringify({ id: "a", photo: "https://example.com/a.png" })}\n`,
		});
		const loaded = await loadTable(input({ repo: "org/urls", rows: 1 }), {
			fields: [{ name: "photo", type: "image" }],
			access: { fetch: down },
		});
		if (!loaded.ok) throw new Error(loaded.error);
		expect(loaded.media).toEqual([]);
		expect(loaded.records).toEqual([{ id: "a", photo: "https://example.com/a.png" }]);
	});

	it("reads a pinned revision's own files, never the conversion of main", async () => {
		served({
			v1: { "train.jsonl": jsonl(5) },
			"refs/convert/parquet": { "default/train/0000.parquet": textParquet(10, 10) },
		});
		const loaded = await loadTable(input({ repo: "org/pinned", rows: 2, revision: "v1" }), {
			access: { fetch: down },
		});
		if (!loaded.ok) throw new Error(loaded.error);
		expect(loaded.source).toMatchObject({ via: "jsonl", revision: "v1" });
	});

	it("counts a csv head's rows within each file as well as across them", async () => {
		served({
			"data/train-0.csv": "id,body\n1,a\n2,b\n",
			"data/train-1.csv": "id,body\n3,c\n4,d\n",
		});
		const loaded = await loadTable(input({ repo: "org/shards", rows: 3 }), {
			access: { fetch: down },
		});
		if (!loaded.ok) throw new Error(loaded.error);
		expect(loaded.origins).toEqual([
			{ row: 0, file: "data/train-0.csv", fileRow: 0 },
			{ row: 1, file: "data/train-0.csv", fileRow: 1 },
			{ row: 2, file: "data/train-1.csv", fileRow: 0 },
		]);
	});

	it("refuses media without the viewer, and anything it cannot read, pointing at the sandbox", async () => {
		served({ "img/train-0.parquet": imageParquet(4, 2, 16) });
		const media = await loadTable(input({ repo: "org/img", rows: 2 }), { access: { fetch: down } });
		expect(media).toMatchObject({
			ok: false,
			error: expect.stringMatching(
				/could not be read without a job[\s\S]*image media, which the pane loads only through the dataset viewer[\s\S]*source\.sandbox/
			),
		});
		expect(vi.mocked(hub.downloadFile)).toHaveBeenCalledTimes(1);

		served({ main: { "shards/0000.tar": "x" }, "refs/convert/parquet": {} });
		const tars = await loadTable(input({ repo: "org/wds" }), { access: { fetch: down } });
		expect(tars).toMatchObject({
			ok: false,
			error: expect.stringMatching(
				/Parquet files at main: none[\s\S]*refs\/convert\/parquet: no conversion[\s\S]*JSONL or CSV files at main: none[\s\S]*source\.sandbox/
			),
		});
	});

	it("keeps where and query on the viewer, with an error the model can act on", async () => {
		const loaded = await loadTable(input({ repo: "org/set", where: '"label" = 1' }), {
			access: { fetch: down },
		});
		expect(loaded).toMatchObject({
			ok: false,
			error: expect.stringMatching(/could not filter org\/set.*sample without them/),
		});
		expect(hub.listFiles).not.toHaveBeenCalled();
	});

	it("says a private or gated dataset needs access when the files refuse too", async () => {
		vi.mocked(hub.listFiles).mockImplementation(async function* () {
			yield* [];
			throw new hub.HubApiError("https://huggingface.co/api/datasets/org/gated/tree/main", 401);
		});
		const denied = await loadTable(input({ repo: "org/gated" }), {
			access: { fetch: fakeViewer({ status: 401, error: "The dataset does not exist" }).fetch },
		});
		expect(denied).toMatchObject({ ok: false, error: expect.stringContaining("private or gated") });
	});
});
