import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { listMlArtefacts } from "$lib/server/mlRegistry/store";
import type { BuiltinToolContext } from "./types";

const hub = vi.hoisted(() => ({ createRepo: vi.fn(), uploadFiles: vi.fn() }));
vi.mock("@huggingface/hub", () => hub);

const { createWorkflowTool, GRADIO_VERSION } = await import("./createWorkflowTool");

const ctx = {} as BuiltinToolContext;
const tool = (namespace: string | undefined = "pngwn") =>
	createWorkflowTool(
		() => namespace,
		() => "hf_x"
	);

/** Hub model records, keyed by id; anything absent 404s. */
let models: Record<
	string,
	{ pipeline_tag?: string; providers?: string[]; names?: string[]; providerTask?: string }
>;

/** Space records, keyed by id; anything absent 404s. */
let spaces: Record<string, { sdk?: string; stage?: string }>;
const host = (id: string) => `https://${id.replace("/", "-")}.hf.space`;
const MOSS_API = {
	named_endpoints: {
		"/on_load": { parameters: [], returns: [] },
		"/generate": {
			parameters: [
				{ label: "Prompt", component: "Textbox", parameter_has_default: false },
				{ label: "Steps", component: "Slider", parameter_has_default: true, parameter_default: 8 },
			],
			returns: [
				{ label: "Generated image", component: "Image" },
				{ label: "Seed used", component: "Number" },
			],
		},
	},
};

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
	spaces = { "hugging-apps/moss": { sdk: "gradio", stage: "RUNNING" } };
	hub.createRepo.mockReset().mockResolvedValue({});
	hub.uploadFiles.mockReset().mockResolvedValue({});
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const { pathname } = new URL(url);
			if (pathname === "/gradio_api/info") {
				if (new Headers(init?.headers).has("Authorization")) throw new Error("token leaked");
				return Response.json(MOSS_API);
			}
			if (pathname.startsWith("/api/spaces/")) {
				const id = pathname.replace("/api/spaces/", "");
				const space = spaces[id];
				if (!space) return new Response("", { status: 404 });
				return Response.json({ sdk: space.sdk, runtime: { stage: space.stage }, host: host(id) });
			}
			const id = decodeURIComponent(pathname.replace("/api/models/", ""));
			const model = models[id];
			if (!model) return new Response("", { status: 404 });
			const inferenceProviderMapping = Object.fromEntries(
				(model.providers ?? []).map((status, i) => [
					model.names?.[i] ?? `p${i}`,
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

const graph = async () => JSON.parse(await uploaded("workflow.json"));

async function error(args: Record<string, unknown>, namespace?: string): Promise<string> {
	const result = await tool(namespace).execute(args, ctx);
	if (!("error" in result)) throw new Error("expected an error");
	return result.error;
}

describe("create_workflow", () => {
	it("writes a compare Space the visitor's token can run", async () => {
		const result = await tool().execute(compare, ctx);

		if (!("resultText" in result)) throw new Error(JSON.stringify(result));
		expect(result.resultText).toContain(
			"https://huggingface.co/spaces/pngwn/product-shots-workflow"
		);
		expect(await uploaded("app.py")).toContain('gr.Workflow(graph="workflow.json")');
		const { operators, references, edges, subjects } = await graph();
		expect(operators.map((op: { id: string }) => op.id)).toEqual([
			"op_krea_2_turbo",
			"op_flux_1_dev",
		]);
		// One prompt reaches both models, under the endpoint's own parameter name.
		expect(references.map((ref: { id: string }) => ref.id)).toEqual(["ref_prompt"]);
		expect(edges).toContainEqual(
			expect.objectContaining({ from_node_id: "ref_prompt", to_port_id: "prompt" })
		);
		expect(subjects.map((sub: { label: string }) => sub.label)).toEqual([
			"Krea-2-Turbo",
			"FLUX.1-dev",
		]);
		const readme = await uploaded("README.md");
		expect(readme).toContain("hf_oauth_scopes:\n  - inference-api\n");
		expect(readme).not.toContain("write-repos");
		expect(readme).toContain(`sdk_version: ${GRADIO_VERSION}`);
	});

	it("wires a chain in step order, leaving optional ports unasked", async () => {
		models = {
			"openai/whisper-large-v3-turbo": {
				pipeline_tag: "automatic-speech-recognition",
				providers: ["live"],
			},
			"facebook/bart-large-cnn": { pipeline_tag: "summarization", providers: ["live"] },
			"Helsinki-NLP/opus-mt-en-fr": { pipeline_tag: "translation", providers: ["live"] },
		};
		await tool().execute(
			{
				shape: "chain",
				name: "Transcribe, summarize, translate",
				steps: [
					{ model: "openai/whisper-large-v3-turbo", task: "automatic-speech-recognition" },
					{ model: "facebook/bart-large-cnn", task: "summarization" },
					{ model: "Helsinki-NLP/opus-mt-en-fr", task: "translation" },
				],
			},
			ctx
		);

		const { references, edges, subjects } = await graph();
		expect(edges).toContainEqual(
			expect.objectContaining({
				from_node_id: "op_whisper_large_v3_turbo",
				from_port_id: "out_0",
				to_node_id: "op_bart_large_cnn",
				to_port_id: "text",
			})
		);
		// Only the audio is asked for, and only the translation comes back.
		expect(references.map((ref: { id: string }) => ref.id)).toEqual([
			"ref_op_whisper_large_v3_turbo_audio",
		]);
		expect(subjects).toHaveLength(1);
	});

	it("compares a model against a Space that serves one no provider does", async () => {
		await tool().execute(
			{
				shape: "compare",
				task: "text-to-image",
				models: ["black-forest-labs/FLUX.1-dev"],
				spaces: [{ space: "hugging-apps/moss" }],
				name: "MOSS vs FLUX",
			},
			ctx
		);

		const { operators, references, edges, subjects } = await graph();
		// The seed the Space reports stays on its card, not a second result tile.
		expect(subjects.map((sub: { label: string }) => sub.label)).toEqual(["FLUX.1-dev", "moss"]);
		expect(operators[1]).toMatchObject({
			id: "op_moss",
			kind: "space",
			space_id: "hugging-apps/moss",
			endpoint: "/generate",
		});
		// One prompt reaches both; the Space's steps run with their default.
		expect(references.map((ref: { id: string }) => ref.id)).toEqual(["ref_prompt"]);
		expect(edges).toContainEqual(
			expect.objectContaining({
				from_node_id: "ref_prompt",
				to_node_id: "op_moss",
				to_port_id: "in_0",
			})
		);
	});

	it.each<[Record<string, unknown>, string, (() => void)?]>([
		[{ ...compare, models: ["krea/Krea-2-Turbo"] }, "gr.Interface"],
		[{ ...compare, models: ["krea/Krea-2-Turbo", "nobody/missing"] }, "does not resolve"],
		[{ ...compare, models: ["krea/Krea-2-Turbo", "https://x.co/a"] }, "not a model id"],
		[{ ...compare, task: "image-to-image" }, "not image-to-image"],
		[{ ...compare, task: "depth-estimation" }, "cannot call a depth-estimation task"],
		[{ ...compare, namespace: "a/b" }, "not a Hub namespace"],
		[{ ...compare, shape: "fan" }, "shape must be"],
		[{ ...compare, name: " " }, "No name provided."],
		[
			{
				shape: "chain",
				name: "x",
				steps: [
					{ model: "krea/Krea-2-Turbo", task: "text-to-image" },
					{ model: "facebook/bart-large-cnn", task: "summarization" },
				],
			},
			"outputs image, but facebook/bart-large-cnn takes text",
			() =>
				(models["facebook/bart-large-cnn"] = {
					pipeline_tag: "summarization",
					providers: ["live"],
				}),
		],
		[
			{ ...compare, spaces: [{ space: "hugging-apps/moss" }] },
			"is SLEEPING",
			() => (spaces["hugging-apps/moss"].stage = "SLEEPING"),
		],
		[
			{ ...compare, spaces: [{ space: "hugging-apps/moss" }] },
			"can only call a Gradio Space",
			() => (spaces["hugging-apps/moss"].sdk = "docker"),
		],
		[
			{ ...compare, spaces: [{ space: "hugging-apps/moss", endpoint: "predict" }] },
			"no /predict endpoint — it has /generate",
		],
		[
			{
				shape: "chain",
				name: "x",
				steps: [
					{ space: "hugging-apps/moss", endpoint: "/on_load" },
					{ model: "krea/Krea-2-Turbo", task: "text-to-image" },
				],
			},
			"hugging-apps/moss returns nothing to feed the next step",
		],
		[
			compare,
			"not served by any inference provider",
			() => (models["krea/Krea-2-Turbo"] = { ...t2i, providers: ["error"] }),
		],
		[
			compare,
			"not served by any inference provider for text-to-image",
			() => (models["krea/Krea-2-Turbo"] = { ...t2i, providerTask: "image-to-image" }),
		],
	])("refuses before writing anything: %j", async (args, message, setup) => {
		setup?.();
		expect(await error(args)).toContain(message);
		expect(hub.createRepo).not.toHaveBeenCalled();
		expect(hub.uploadFiles).not.toHaveBeenCalled();
	});

	it("refuses rather than guessing when there is no namespace", async () => {
		expect(await error(compare, "")).toContain("hf_whoami");
	});

	it("asks for a different name, not more permissions, on a 403", async () => {
		hub.uploadFiles.mockRejectedValue(Object.assign(new Error("no"), { statusCode: 403 }));
		expect(await error(compare)).toContain("different name");
	});

	it("pins each model to a live provider, hf-inference first", async () => {
		models["krea/Krea-2-Turbo"] = {
			...t2i,
			providers: ["live", "live"],
			names: ["together", "hf-inference"],
		};
		models["black-forest-labs/FLUX.1-dev"] = { ...t2i, providers: ["error", "live"] };
		await tool().execute(compare, ctx);

		const { operators } = await graph();
		expect(operators.map((op: { provider: string }) => op.provider)).toEqual([
			"hf-inference",
			"p1",
		]);
	});

	it("never leaves a `--` where a long name is cut", async () => {
		await tool().execute({ ...compare, name: `${"a".repeat(79)} b` }, ctx);

		expect(hub.createRepo.mock.calls[0][0].repo.name).toBe(`pngwn/${"a".repeat(79)}-workflow`);
	});

	it("records the Space, and updates it on a rerun but not one made elsewhere", async () => {
		const conversationId = new ObjectId();
		conversationIds.push(conversationId);
		const uri = "hf://spaces/pngwn/product-shots-workflow";
		await tool().execute(compare, { ...ctx, conversationId, uuid: "uuid-7" });
		await vi.waitFor(async () => {
			expect(await listMlArtefacts(conversationId)).toMatchObject([
				{ kind: "space", uri, toolUuid: "uuid-7" },
			]);
		});

		hub.createRepo.mockRejectedValue(Object.assign(new Error("exists"), { statusCode: 409 }));
		const other = { ...ctx, conversationId: new ObjectId() };
		expect(await tool().execute(compare, other)).toHaveProperty("error");
		expect(await tool().execute(compare, { ...ctx, conversationId })).toHaveProperty("resultText");
	});
	it("lets a retry reuse a Space whose upload failed", async () => {
		const conversationId = new ObjectId();
		conversationIds.push(conversationId);
		hub.uploadFiles.mockRejectedValueOnce(Object.assign(new Error("down"), { statusCode: 500 }));
		expect(await tool().execute(compare, { ...ctx, conversationId })).toHaveProperty("error");

		hub.createRepo.mockRejectedValue(Object.assign(new Error("exists"), { statusCode: 409 }));
		expect(await tool().execute(compare, { ...ctx, conversationId })).toHaveProperty("resultText");
	});

	it.each([
		// Served under its own tag, an alias of the endpoint's.
		["text-to-audio", { pipeline_tag: "text-to-audio", providers: ["live"] }],
		// No model is tagged `conversational`; text-generation ones are what it means.
		[
			"conversational",
			{ pipeline_tag: "text-generation", providers: ["live"], providerTask: "conversational" },
		],
	])("accepts a %s step", async (task, model) => {
		models = { "a/one": model, "b/two": model };
		const result = await tool().execute({ ...compare, task, models: ["a/one", "b/two"] }, ctx);

		expect(result).toHaveProperty("resultText");
	});
});
