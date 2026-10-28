import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { listMlArtefacts, recordArtefact } from "$lib/server/mlRegistry/store";
import type { BuiltinToolContext } from "./types";

const hub = vi.hoisted(() => ({ createRepo: vi.fn(), uploadFiles: vi.fn() }));
vi.mock("@huggingface/hub", () => hub);

const { createWorkflowTool, CREATE_WORKFLOW_TOOL_NAME, GRADIO_VERSION } =
	await import("./createWorkflowTool");

const ctx = {} as BuiltinToolContext;
const tool = (namespace: string | undefined = "pngwn") =>
	createWorkflowTool(
		() => namespace,
		() => "hf_x"
	);

/** Hub model records, keyed by id; anything absent 404s. */
let models: Record<string, { pipeline_tag?: string; providers?: string[]; providerTask?: string }>;

const t2i = { pipeline_tag: "text-to-image", providers: ["live"] };
const compare = {
	shape: "compare",
	models: ["krea/Krea-2-Turbo", "black-forest-labs/FLUX.1-dev"],
	task: "text-to-image",
	name: "Product shots",
};

beforeAll(async () => {
	await ready;
});

beforeEach(() => {
	models = { "krea/Krea-2-Turbo": t2i, "black-forest-labs/FLUX.1-dev": t2i };
	hub.createRepo.mockReset().mockResolvedValue({});
	hub.uploadFiles.mockReset().mockResolvedValue({});
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			const id = decodeURIComponent(new URL(url).pathname.replace("/api/models/", ""));
			const model = models[id];
			if (!model) return new Response("", { status: 404 });
			const inferenceProviderMapping = Object.fromEntries(
				(model.providers ?? []).map((status, i) => [
					`p${i}`,
					{ status, task: model.providerTask ?? model.pipeline_tag },
				])
			);
			return Response.json({ pipeline_tag: model.pipeline_tag, inferenceProviderMapping });
		})
	);
});

const conversationIds: ObjectId[] = [];

afterEach(async () => {
	vi.unstubAllGlobals();
	await collections.mlArtefacts.deleteMany({ conversationId: { $in: conversationIds } });
	conversationIds.length = 0;
});

async function uploaded(path: string): Promise<string> {
	const files: { path: string; content: Blob }[] = hub.uploadFiles.mock.calls[0][0].files;
	const file = files.find((f) => f.path === path);
	if (!file) throw new Error(`${path} was not uploaded`);
	return file.content.text();
}

describe("create_workflow", () => {
	it("writes a compare Space the visitor's token can run", async () => {
		const result = await tool().execute(compare, ctx);

		if (!("resultText" in result)) throw new Error(JSON.stringify(result));
		expect(result.resultText).toContain(
			"https://huggingface.co/spaces/pngwn/product-shots-workflow"
		);
		expect(hub.createRepo).toHaveBeenCalledWith(
			expect.objectContaining({
				repo: { type: "space", name: "pngwn/product-shots-workflow" },
				sdk: "gradio",
			})
		);
		expect(await uploaded("app.py")).toContain('gr.Workflow(graph="workflow.json")');
		const graph = JSON.parse(await uploaded("workflow.json"));
		if (process.env.WORKFLOW_DUMP) {
			const { writeFileSync } = await import("node:fs");
			writeFileSync(`${process.env.WORKFLOW_DUMP}/compare.json`, JSON.stringify(graph));
		}
		expect(graph.schema_version).toBe("2");
		expect(graph.operators.map((op: { id: string }) => op.id)).toEqual([
			"op_krea_2_turbo",
			"op_flux_1_dev",
		]);
		// One prompt reaches both models, under the endpoint's own parameter name.
		expect(graph.references.map((ref: { id: string }) => ref.id)).toEqual(["ref_prompt"]);
		expect(graph.edges).toContainEqual(
			expect.objectContaining({
				from_node_id: "ref_prompt",
				to_node_id: "op_flux_1_dev",
				to_port_id: "prompt",
			})
		);
		expect(graph.subjects.map((sub: { label: string }) => sub.label)).toEqual([
			"Krea-2-Turbo",
			"FLUX.1-dev",
		]);
		const readme = await uploaded("README.md");
		expect(readme).toContain("hf_oauth: true\nhf_oauth_scopes:\n  - inference-api\n");
		expect(readme).not.toContain("write-repos");
		expect(readme).toContain(`sdk_version: ${GRADIO_VERSION}`);
		expect(readme).toContain("built-with-ml-intern");
	});

	it("writes a chain in step order", async () => {
		models = {
			"openai/whisper-large-v3-turbo": {
				pipeline_tag: "automatic-speech-recognition",
				providers: ["live"],
			},
			"facebook/bart-large-cnn": { pipeline_tag: "summarization", providers: ["live"] },
		};
		const result = await tool().execute(
			{
				shape: "chain",
				name: "Transcribe and summarize",
				steps: [
					{ model: "openai/whisper-large-v3-turbo", task: "automatic-speech-recognition" },
					{ model: "facebook/bart-large-cnn", task: "summarization" },
				],
			},
			ctx
		);

		expect(result).toHaveProperty("resultText");
		const graph = JSON.parse(await uploaded("workflow.json"));
		expect(graph.edges).toContainEqual(
			expect.objectContaining({
				from_node_id: "op_whisper_large_v3_turbo",
				from_port_id: "out_0",
				to_node_id: "op_bart_large_cnn",
				to_port_id: "text",
			})
		);
		// Only the audio is asked for, and only the summary comes back.
		expect(graph.references).toHaveLength(1);
		expect(graph.subjects).toHaveLength(1);
		if (process.env.WORKFLOW_DUMP) {
			const { writeFileSync } = await import("node:fs");
			writeFileSync(`${process.env.WORKFLOW_DUMP}/chain.json`, JSON.stringify(graph));
		}
	});

	it("leaves a translation's optional language ports unasked", async () => {
		models = {
			"facebook/bart-large-cnn": { pipeline_tag: "summarization", providers: ["live"] },
			"Helsinki-NLP/opus-mt-en-fr": { pipeline_tag: "translation", providers: ["live"] },
		};
		await tool().execute(
			{
				shape: "chain",
				name: "Summarize in French",
				steps: [
					{ model: "facebook/bart-large-cnn", task: "summarization" },
					{ model: "Helsinki-NLP/opus-mt-en-fr", task: "translation" },
				],
			},
			ctx
		);

		const graph = JSON.parse(await uploaded("workflow.json"));
		expect(graph.references.map((ref: { id: string }) => ref.id)).toEqual([
			"ref_op_bart_large_cnn_text",
		]);
	});

	it("refuses a chain whose steps do not connect", async () => {
		models = {
			"krea/Krea-2-Turbo": t2i,
			"facebook/bart-large-cnn": { pipeline_tag: "summarization", providers: ["live"] },
		};
		const result = await tool().execute(
			{
				shape: "chain",
				name: "x",
				steps: [
					{ model: "krea/Krea-2-Turbo", task: "text-to-image" },
					{ model: "facebook/bart-large-cnn", task: "summarization" },
				],
			},
			ctx
		);

		if (!("error" in result)) throw new Error("expected an error");
		expect(result.error).toContain("outputs image, but facebook/bart-large-cnn takes text");
		expect(hub.uploadFiles).not.toHaveBeenCalled();
	});

	it("updates the same Space on a rerun, but not one made elsewhere", async () => {
		const conversationId = new ObjectId();
		conversationIds.push(conversationId);
		hub.createRepo.mockRejectedValue(Object.assign(new Error("exists"), { statusCode: 409 }));
		expect(await tool().execute(compare, { ...ctx, conversationId })).toHaveProperty("error");

		const uri = "hf://spaces/pngwn/product-shots-workflow";
		await recordArtefact({ conversationId, kind: "space", uri, url: "" });
		expect(await tool().execute(compare, { ...ctx, conversationId })).toHaveProperty("resultText");
	});

	it("never leaves a `--` where a long name is cut", async () => {
		await tool().execute({ ...compare, name: `${"a".repeat(79)} b` }, ctx);

		expect(hub.createRepo.mock.calls[0][0].repo.name).toBe(`pngwn/${"a".repeat(79)}-workflow`);
	});

	it.each([
		[{ ...compare, models: ["krea/Krea-2-Turbo"] }, "gr.Interface"],
		[{ ...compare, models: ["krea/Krea-2-Turbo", "nobody/missing"] }, "does not resolve"],
		[{ ...compare, models: ["krea/Krea-2-Turbo", "https://x.co/a"] }, "not a model id"],
		[{ ...compare, task: "image-to-image" }, "not image-to-image"],
		[{ ...compare, task: "depth-estimation" }, "cannot call a depth-estimation task"],
		[{ ...compare, namespace: "a/b" }, "not a Hub namespace"],
		[{ ...compare, shape: "fan" }, "shape must be"],
		[{ ...compare, name: " " }, "No name provided."],
	])("refuses before writing anything: %j", async (args, message) => {
		const result = await tool().execute(args, ctx);

		if (!("error" in result)) throw new Error("expected an error");
		expect(result.error).toContain(message);
		expect(hub.createRepo).not.toHaveBeenCalled();
		expect(hub.uploadFiles).not.toHaveBeenCalled();
	});

	it("refuses a model no provider serves, since the node would 404 on Run", async () => {
		models["krea/Krea-2-Turbo"] = { pipeline_tag: "text-to-image", providers: ["error"] };
		const result = await tool().execute(compare, ctx);

		if (!("error" in result)) throw new Error("expected an error");
		expect(result.error).toContain("not served by any inference provider");
	});

	it("refuses a model served live only for another task", async () => {
		models["krea/Krea-2-Turbo"] = { ...t2i, providerTask: "image-to-image" };
		const result = await tool().execute(compare, ctx);

		if (!("error" in result)) throw new Error("expected an error");
		expect(result.error).toContain("not served by any inference provider for text-to-image");
	});

	it("warns when one provider is all that serves a model", async () => {
		models["black-forest-labs/FLUX.1-dev"] = { ...t2i, providers: ["live", "live"] };
		const result = await tool().execute(compare, ctx);

		if (!("resultText" in result)) throw new Error(JSON.stringify(result));
		expect(result.resultText).toContain("Only one provider serves krea/Krea-2-Turbo (p0).");
		expect(result.resultText).not.toContain("FLUX.1-dev (");
	});

	it("asks for a different name, not more permissions, on a 403", async () => {
		hub.uploadFiles.mockRejectedValue(Object.assign(new Error("no"), { statusCode: 403 }));
		const result = await tool().execute(compare, ctx);

		if (!("error" in result)) throw new Error("expected an error");
		expect(result.error).toContain("different name");
	});

	it("refuses rather than guessing when there is no namespace", async () => {
		const result = await createWorkflowTool(
			() => undefined,
			() => "hf_x"
		).execute(compare, ctx);

		if (!("error" in result)) throw new Error("expected an error");
		expect(result.error).toContain("hf_whoami");
	});

	it("records the Space as an artefact of the conversation", async () => {
		const conversationId = new ObjectId();
		conversationIds.push(conversationId);
		await tool().execute(compare, { ...ctx, conversationId, uuid: "uuid-7" });

		await vi.waitFor(async () => {
			expect(await listMlArtefacts(conversationId)).toHaveLength(1);
		});
		expect((await listMlArtefacts(conversationId))[0]).toMatchObject({
			kind: "space",
			uri: "hf://spaces/pngwn/product-shots-workflow",
			toolUuid: "uuid-7",
		});
	});

	it("is exempt from tool restraint", () => {
		expect(tool().exemptFromToolRestraint).toBe(true);
		expect(tool().name).toBe(CREATE_WORKFLOW_TOOL_NAME);
	});
});
