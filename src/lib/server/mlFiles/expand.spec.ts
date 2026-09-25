import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { createVirtualFileExpander } from "./expand";
import { writeMlFileVersion } from "./store";

const HUB = "https://huggingface.co/mcp?login&bouquet=intern";
const OTHER = "https://other.test/mcp";

beforeAll(async () => {
	await ready;
});

afterEach(async () => {
	await collections.mlFiles.deleteMany({});
});

async function seeded() {
	const conversationId = new ObjectId();
	await writeMlFileVersion({ conversationId, name: "train.py", content: "v1", origin: "write" });
	await writeMlFileVersion({ conversationId, name: "train.py", content: "v2", origin: "edit" });
	await writeMlFileVersion({ conversationId, name: "eval.py", content: "e", origin: "write" });
	return { conversationId, expand: createVirtualFileExpander(conversationId) };
}

describe("createVirtualFileExpander", () => {
	it("expands hf_jobs script for uv and scheduled uv, latest version by default", async () => {
		const { expand } = await seeded();
		for (const operation of ["uv", "scheduled uv"]) {
			const args = { operation, args: { script: "v-file://train.py", flavor: "cpu-basic" } };
			const result = await expand({ serverUrl: HUB, tool: "hf_jobs", args });

			expect(result).toEqual({
				args: { operation, args: { script: "v2", flavor: "cpu-basic" } },
				fileRefs: [{ ref: "v-file://train.py", name: "train.py", version: 2 }],
			});
			expect(args.args.script).toBe("v-file://train.py");
		}
	});

	it("expands hf_fs_write content for put", async () => {
		const { expand } = await seeded();
		const result = await expand({
			serverUrl: HUB,
			tool: "hf_fs_write",
			args: {
				cmd: "put",
				args: ["put", "hf://models/a/b/train.py"],
				content: "v-file://train.py@v1",
			},
		});
		expect(result).toEqual({
			args: { cmd: "put", args: ["put", "hf://models/a/b/train.py"], content: "v1" },
			fileRefs: [{ ref: "v-file://train.py@v1", name: "train.py", version: 1 }],
		});
	});

	it("expands the token after --text in hf_sandbox_fs write", async () => {
		const { expand } = await seeded();
		const result = await expand({
			serverUrl: HUB,
			tool: "hf_sandbox_fs",
			args: {
				cmd: "write",
				args: ["write", "hfsb2:o:1", "/work/train.py", "--text", "v-file://train.py"],
			},
		});
		expect(result).toEqual({
			args: { cmd: "write", args: ["write", "hfsb2:o:1", "/work/train.py", "--text", "v2"] },
			fileRefs: [{ ref: "v-file://train.py", name: "train.py", version: 2 }],
		});
	});

	it("leaves a reference alone anywhere else", async () => {
		const { expand } = await seeded();
		const cases = [
			{ tool: "hf_jobs", args: { operation: "logs", args: { script: "v-file://train.py" } } },
			{ tool: "hf_fs_write", args: { cmd: "rm", content: "v-file://train.py" } },
			{ tool: "hf_sandbox_fs", args: { cmd: "cat", args: ["cat", "h", "v-file://train.py"] } },
			{ tool: "hf_jobs", args: { operation: "run", args: { script: "v-file://train.py" } } },
			{ tool: "hf_jobs", args: { operation: "run", args: { command: ["python", "other.py"] } } },
			{ tool: "hf_fs_write", args: { cmd: "put", args: ["put", "v-file://train.py"] } },
			{ tool: "hf_sandbox_fs", args: { cmd: "write", args: ["write", "h", "v-file://train.py"] } },
			{
				tool: "hf_jobs",
				args: { operation: "uv", args: { script: "# from v-file://train.py\n" } },
			},
			{ tool: "hf_fs", args: { cmd: "cat", args: ["v-file://train.py"] } },
		];
		for (const { tool, args } of cases) {
			expect(await expand({ serverUrl: HUB, tool, args }), tool).toEqual({ args, fileRefs: [] });
		}
	});

	it("refuses a run command that names a virtual file, by reference or bare name", async () => {
		const { expand } = await seeded();
		const commands = [
			["python", "v-file://train.py"],
			["python", "train.py"],
			["python", "./train.py", "--lr", "1e-4"],
			"python train.py",
		];
		for (const command of commands) {
			const result = await expand({
				serverUrl: HUB,
				tool: "hf_jobs",
				args: { operation: "run", args: { image: "python:3.12", command } },
			});
			expect(result, JSON.stringify(command)).toEqual({
				error: expect.stringContaining('"script": "v-file://train.py"'),
			});
		}

		const scheduled = await expand({
			serverUrl: HUB,
			tool: "hf_jobs",
			args: {
				operation: "scheduled run",
				args: { schedule: "@daily", command: ["python", "eval.py"] },
			},
		});
		expect(scheduled).toEqual({ error: expect.stringContaining('"operation": "scheduled uv"') });
	});

	it("never touches a same-named tool on another server", async () => {
		const { expand } = await seeded();
		const args = { operation: "uv", args: { script: "v-file://train.py" } };
		expect(await expand({ serverUrl: OTHER, tool: "hf_jobs", args })).toEqual({
			args,
			fileRefs: [],
		});
	});

	it("refuses a reference that does not resolve, naming it and what exists", async () => {
		const { expand } = await seeded();
		const missing = await expand({
			serverUrl: HUB,
			tool: "hf_jobs",
			args: { operation: "uv", args: { script: "v-file://missing.py" } },
		});
		expect(missing).toEqual({
			error: expect.stringContaining("v-file://missing.py does not resolve"),
		});
		if ("error" in missing) {
			expect(missing.error).toContain("v-file://train.py (v2)");
			expect(missing.error).toContain("v-file://eval.py (v1)");
		}

		const badVersion = await expand({
			serverUrl: HUB,
			tool: "hf_fs_write",
			args: { cmd: "put", args: ["put", "hf://x/y/z"], content: "v-file://train.py@v9" },
		});
		expect(badVersion).toEqual({ error: expect.stringContaining("versions run v1 to v2") });
	});

	it("says there are no files yet in an empty conversation", async () => {
		const expand = createVirtualFileExpander(new ObjectId());
		const result = await expand({
			serverUrl: HUB,
			tool: "hf_jobs",
			args: { operation: "uv", args: { script: "v-file://train.py" } },
		});
		expect(result).toEqual({ error: expect.stringContaining("write one with write_file first") });
	});
});
