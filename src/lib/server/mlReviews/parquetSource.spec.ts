import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { parquetMetadata } from "hyparquet";
import { parquetWriteBuffer } from "hyparquet-writer";

vi.mock("@huggingface/hub", async (importOriginal) => ({
	...(await importOriginal<typeof import("@huggingface/hub")>()),
	downloadFile: vi.fn(),
}));

const hub = await import("@huggingface/hub");
const {
	DecodeBudget,
	ParquetReadError,
	ReadBudget,
	guardedCompressors,
	mediaCacheSizes,
	readMediaCell,
	readSegment,
} = await import("./parquetSource");
type OpenParquet = import("./parquetSource").OpenParquet;

const MB = 1024 * 1024;

function gzipParquet(text: string): ArrayBuffer {
	return parquetWriteBuffer({
		columnData: [{ name: "text", data: [text], type: "STRING" }],
		codec: "GZIP",
		compressors: { GZIP: (bytes: Uint8Array) => new Uint8Array(gzipSync(bytes)) },
		pageSize: 8 * MB,
	});
}

function opened(buffer: ArrayBuffer): OpenParquet {
	const metadata = parquetMetadata(buffer);
	return {
		path: "bomb.parquet",
		file: buffer,
		blob: new Blob([buffer]),
		metadata,
		rows: Number(metadata.num_rows),
		start: 0,
	};
}

/** thrift compact varints, so a page header field can be rewritten in place */
function readVarint(bytes: Uint8Array, at: number): { value: number; length: number } {
	let value = 0;
	let shift = 0;
	let length = 0;
	for (;;) {
		const byte = bytes[at + length];
		value += (byte & 0x7f) * 2 ** shift;
		length += 1;
		if ((byte & 0x80) === 0) return { value, length };
		shift += 7;
	}
}

function writeVarint(value: number, length: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < length; i += 1) {
		const low = value % 128;
		value = Math.floor(value / 128);
		out.push(i < length - 1 ? low | 0x80 : low);
	}
	if (value !== 0) throw new Error("value does not fit");
	return out;
}

/** the page header claims far more than the footer says, the bytes on the wire stay tiny */
function craftedBomb(claimed: number): ArrayBuffer {
	const buffer = gzipParquet("0".repeat(2 * MB));
	const bytes = new Uint8Array(buffer.slice(0));
	const offset = Number(
		parquetMetadata(buffer).row_groups[0].columns[0].meta_data?.data_page_offset
	);
	// field 1 page type (i32), then field 2 uncompressed_page_size (i32, zigzag)
	expect([bytes[offset], bytes[offset + 2]]).toEqual([0x15, 0x15]);
	const size = readVarint(bytes, offset + 3);
	bytes.set(writeVarint(claimed * 2, size.length), offset + 3);
	return bytes.buffer;
}

describe("decoding Parquet within a budget", () => {
	it("refuses a page whose header claims more than a page may decode, before allocating it", async () => {
		const bomb = craftedBomb(115 * MB);
		expect(bomb.byteLength).toBeLessThan(64 * 1024);
		await expect(readSegment({ file: opened(bomb), from: 0, to: 1 }, ["text"])).rejects.toThrow(
			/a Parquet page claims 115 MB decoded, past the 64 MB one page may take/
		);
	});

	it("refuses a read whose chunks claim to decode past the budget, before fetching them", async () => {
		const file = opened(gzipParquet("0".repeat(2 * MB)));
		// hyparquet-writer records the compressed size here, pyarrow records the real one
		const chunk = file.metadata.row_groups[0].columns[0].meta_data;
		if (!chunk) throw new Error("no chunk metadata");
		chunk.total_uncompressed_size = BigInt(3 * MB);
		await expect(
			readSegment({ file, from: 0, to: 1 }, ["text"], new DecodeBudget(MB))
		).rejects.toThrow(/would decode 3 MB, past the 1 MB a read may decode/);
		const rows = await readSegment({ file, from: 0, to: 1 }, ["text"]);
		expect(String(rows[0].text)).toHaveLength(2 * MB);
	});

	it("stops a decode past the budget even when the footer understates it", async () => {
		const file = opened(gzipParquet("0".repeat(2 * MB)));
		await expect(
			readSegment({ file, from: 0, to: 1 }, ["text"], new DecodeBudget(MB))
		).rejects.toThrow(/decoding this sample would pass 1 MB of decoded Parquet/);
	});

	it("checks the claim for every codec, zstd included", () => {
		const guarded = guardedCompressors(new DecodeBudget(10 * MB, MB));
		for (const codec of ["SNAPPY", "GZIP", "ZSTD", "BROTLI", "LZ4", "LZ4_RAW"] as const) {
			expect(() => guarded[codec]?.(new Uint8Array(8), 2_000_000_000)).toThrow(ParquetReadError);
		}
	});
});

function imageFile(rows: number, marker: number): ArrayBuffer {
	return parquetWriteBuffer({
		columnData: [
			{
				name: "image",
				data: Array.from({ length: rows }, (_, i) => ({
					bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, marker, i]),
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
		rowGroupSize: 2,
	});
}

describe("media reads shared by every user on a replica", () => {
	it("keep at most 32 files open and a byte budget per request", async () => {
		const files = Object.fromEntries(
			Array.from({ length: 40 }, (_, i) => [`f${i}.parquet`, imageFile(2, i)])
		);
		vi.mocked(hub.downloadFile).mockImplementation(async ({ path }) =>
			files[path] ? new Blob([files[path]]) : null
		);
		for (let i = 0; i < 40; i += 1) {
			const cell = (await readMediaCell(
				{ repo: { type: "dataset", name: "org/img" }, path: `f${i}.parquet` },
				1,
				"image",
				{ token: "hf_x" }
			)) as { bytes: Uint8Array };
			expect(cell.bytes[4]).toBe(i);
		}
		const sizes = mediaCacheSizes();
		expect(sizes.files).toBeLessThanOrEqual(32);
		expect(sizes.rangeBytes).toBeLessThanOrEqual(64 * MB);

		await expect(
			readMediaCell(
				{ repo: { type: "dataset", name: "org/img" }, path: "f39.parquet" },
				0,
				"image",
				{ token: "hf_other" },
				{ read: new ReadBudget(16) }
			)
		).rejects.toThrow(ParquetReadError);
	});
});
