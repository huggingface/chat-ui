import { describe, expect, it } from "vitest";
import { fileUri, fileUrl, parseHfUri, repoUri, repoUrl } from "./hubUri";

describe("hf:// uris", () => {
	it("reads the repo type, owner and name", () => {
		expect(parseHfUri("hf://datasets/testuser/demo")).toEqual({
			type: "datasets",
			kind: "dataset",
			owner: "testuser",
			name: "demo",
		});
		expect(parseHfUri("hf://buckets/testuser/scratch")?.kind).toBe("bucket");
		expect(parseHfUri("hf://spaces/testuser/app")?.kind).toBe("space");
	});

	it("keeps a file path and a revision apart from the repo", () => {
		const parsed = parseHfUri("hf://models/testuser/tiny@dev/config/train.yaml");
		expect(parsed).toEqual({
			type: "models",
			kind: "model",
			owner: "testuser",
			name: "tiny",
			revision: "dev",
			path: "config/train.yaml",
		});
		if (!parsed?.path) throw new Error("expected a path");
		expect(repoUri(parsed)).toBe("hf://models/testuser/tiny");
		expect(fileUri({ ...parsed, path: parsed.path })).toBe(
			"hf://models/testuser/tiny/config/train.yaml"
		);
	});

	it("rejects anything that is not a repo uri", () => {
		expect(parseHfUri("https://huggingface.co/testuser/tiny")).toBeUndefined();
		expect(parseHfUri("hf://papers/2502.16161")).toBeUndefined();
		expect(parseHfUri("hf://models/testuser")).toBeUndefined();
	});

	it("links models without a type prefix and everything else with one", () => {
		const model = parseHfUri("hf://models/testuser/tiny");
		const dataset = parseHfUri("hf://datasets/testuser/demo");
		if (!model || !dataset) throw new Error("expected repos");
		expect(repoUrl(model)).toBe("https://huggingface.co/testuser/tiny");
		expect(repoUrl(dataset)).toBe("https://huggingface.co/datasets/testuser/demo");
	});

	it("links a file to its page, or to resolve for a bucket", () => {
		const file = parseHfUri("hf://datasets/testuser/demo/data/train v2.jsonl");
		const bucketFile = parseHfUri("hf://buckets/testuser/scratch/ckpt/step-100.pt");
		if (!file?.path || !bucketFile?.path) throw new Error("expected files");
		expect(fileUrl({ ...file, path: file.path })).toBe(
			"https://huggingface.co/datasets/testuser/demo/blob/main/data/train%20v2.jsonl"
		);
		expect(fileUrl({ ...bucketFile, path: bucketFile.path })).toBe(
			"https://huggingface.co/buckets/testuser/scratch/resolve/ckpt/step-100.pt"
		);
	});
});
