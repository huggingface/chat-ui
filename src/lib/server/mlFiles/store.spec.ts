import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import {
	deleteMlFilesOf,
	listMlFiles,
	ML_FILE_MAX_BYTES,
	readMlFile,
	validateMlFileContent,
	validateMlFileName,
	writeMlFileVersion,
} from "./store";

beforeAll(async () => {
	await ready;
});

afterEach(async () => {
	await collections.mlFiles.deleteMany({});
});

describe("validateMlFileName", () => {
	it("accepts relative path-like names", () => {
		for (const name of ["train.py", "configs/sft.yaml", "a-b_c.d", " eval.py "]) {
			expect(validateMlFileName(name)).toEqual({ ok: true, value: name.trim() });
		}
	});

	it("refuses anything that could escape or is not a path", () => {
		for (const name of [
			"",
			"   ",
			"/etc/passwd",
			"../train.py",
			"a/../b.py",
			"a//b.py",
			"./a.py",
			"train.py/",
			"train py.py",
			"a\\b.py",
			"x".repeat(201),
			42,
		]) {
			expect(validateMlFileName(name).ok, String(name)).toBe(false);
		}
	});
});

describe("validateMlFileContent", () => {
	it("refuses binary content and names the cap for oversized text", () => {
		expect(validateMlFileContent("print('ok')\n").ok).toBe(true);
		expect(validateMlFileContent("a\u0000b").ok).toBe(false);
		expect(validateMlFileContent("lone \uD800 surrogate").ok).toBe(false);
		expect(validateMlFileContent(42).ok).toBe(false);

		const tooBig = validateMlFileContent("x".repeat(ML_FILE_MAX_BYTES + 1));
		expect(tooBig.ok).toBe(false);
		if (!tooBig.ok) expect(tooBig.error).toContain("256 KB");
		expect(validateMlFileContent("é".repeat(ML_FILE_MAX_BYTES / 2 + 1)).ok).toBe(false);
		expect(validateMlFileContent("x".repeat(ML_FILE_MAX_BYTES)).ok).toBe(true);
	});
});

describe("the mlFiles store", () => {
	const conversationId = new ObjectId();

	it("numbers versions from 1 and reads the latest by default", async () => {
		const first = await writeMlFileVersion({
			conversationId,
			name: "train.py",
			content: "print(1)\n",
			origin: "write",
			summary: "first draft",
			attribution: { messageId: "m1", generationId: "g1", toolUuid: "u1" },
		});
		const second = await writeMlFileVersion({
			conversationId,
			name: "train.py",
			content: "print(2)\nprint(3)",
			origin: "edit",
		});

		expect(first).toMatchObject({ name: "train.py", version: 1, size: 9, lineCount: 1 });
		expect(second).toMatchObject({ version: 2, size: 17, lineCount: 2 });
		expect(second.sha256).toMatch(/^[0-9a-f]{64}$/);

		const latest = await readMlFile(conversationId, "train.py");
		expect(latest).toMatchObject({ version: 2, content: "print(2)\nprint(3)", origin: "edit" });
		const pinned = await readMlFile(conversationId, "train.py", 1);
		expect(pinned).toMatchObject({
			version: 1,
			content: "print(1)\n",
			summary: "first draft",
			messageId: "m1",
			generationId: "g1",
			toolUuid: "u1",
		});
		expect(await readMlFile(conversationId, "train.py", 3)).toBeNull();
		expect(await readMlFile(conversationId, "missing.py")).toBeNull();
	});

	it("keeps files apart by conversation", async () => {
		const other = new ObjectId();
		await writeMlFileVersion({ conversationId, name: "a.py", content: "a", origin: "write" });
		await writeMlFileVersion({
			conversationId: other,
			name: "a.py",
			content: "b",
			origin: "write",
		});

		expect((await readMlFile(conversationId, "a.py"))?.content).toBe("a");
		expect((await readMlFile(other, "a.py"))?.content).toBe("b");
		expect((await readMlFile(other, "a.py"))?.version).toBe(1);
	});

	it("lists each file once, at its latest version, with its summary", async () => {
		await writeMlFileVersion({ conversationId, name: "b.py", content: "1", origin: "write" });
		await writeMlFileVersion({
			conversationId,
			name: "b.py",
			content: "12",
			origin: "edit",
			summary: "second",
		});
		await writeMlFileVersion({ conversationId, name: "a.py", content: "123", origin: "write" });

		const listing = await listMlFiles(conversationId);
		expect(
			listing.map(({ name, version, size, summary }) => ({ name, version, size, summary }))
		).toEqual([
			{ name: "a.py", version: 1, size: 3, summary: undefined },
			{ name: "b.py", version: 2, size: 2, summary: "second" },
		]);
		expect(listing[1].updatedAt).toBeInstanceOf(Date);
		expect(await listMlFiles(new ObjectId())).toEqual([]);
	});

	it("lands a pinned write only on top of the version it was derived from", async () => {
		await writeMlFileVersion({ conversationId, name: "p.py", content: "1", origin: "write" });
		await writeMlFileVersion({ conversationId, name: "p.py", content: "2", origin: "write" });

		const stale = await writeMlFileVersion({
			conversationId,
			name: "p.py",
			content: "from v1",
			origin: "edit",
			baseVersion: 1,
		});
		expect(stale).toEqual({ conflict: true, latestVersion: 2 });

		const fresh = await writeMlFileVersion({
			conversationId,
			name: "p.py",
			content: "from v2",
			origin: "edit",
			baseVersion: 2,
		});
		expect(fresh).toMatchObject({ version: 3 });
		expect((await readMlFile(conversationId, "p.py"))?.content).toBe("from v2");
	});

	it("deletes every version of every file a conversation owns, and nothing else", async () => {
		const other = new ObjectId();
		await writeMlFileVersion({ conversationId, name: "a.py", content: "1", origin: "write" });
		await writeMlFileVersion({ conversationId, name: "a.py", content: "2", origin: "edit" });
		await writeMlFileVersion({ conversationId, name: "b.py", content: "3", origin: "write" });
		await writeMlFileVersion({
			conversationId: other,
			name: "a.py",
			content: "4",
			origin: "write",
		});

		await deleteMlFilesOf([conversationId]);

		expect(await listMlFiles(conversationId)).toEqual([]);
		expect((await listMlFiles(other)).map((file) => file.name)).toEqual(["a.py"]);
		await deleteMlFilesOf([]);
	});

	it("survives two concurrent writes of the same name without losing one", async () => {
		await Promise.all([
			writeMlFileVersion({ conversationId, name: "race.py", content: "x", origin: "write" }),
			writeMlFileVersion({ conversationId, name: "race.py", content: "y", origin: "write" }),
		]);
		const versions = await collections.mlFiles
			.find({ conversationId, name: "race.py" })
			.sort({ version: 1 })
			.toArray();
		expect(versions.map((row) => row.version)).toEqual([1, 2]);
	});
});
