import { createRepo, uploadFiles } from "@huggingface/hub";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import type { OpenAiTool } from "$lib/server/mcp/tools";
import { knownArtefactUris, recordArtefact } from "$lib/server/mlRegistry/store";
import type { BuiltinTool, BuiltinToolContext } from "./types";

export const CREATE_WORKFLOW_TOOL_NAME = "create_workflow";

export const workflowsEnabled = (): boolean => config.ML_ASSISTANT_WORKFLOWS !== "false";

/** The gradio release the generated graph is written against, pinned in the Space's README. */
export const GRADIO_VERSION = "6.30.0";

const definition: OpenAiTool = {
	type: "function",
	function: {
		name: CREATE_WORKFLOW_TOOL_NAME,
		description:
			"Deploy a gr.Workflow Space that runs Hub models side by side on the same input " +
			"(shape 'compare'), or feeds each model's output into the next (shape 'chain'). Every " +
			"model is checked against the Hub first — that it exists, does the task, and is served " +
			"by an inference provider — and nothing is written unless all of them pass. Returns the " +
			"Space URL.",
		parameters: {
			type: "object",
			properties: {
				shape: { type: "string", enum: ["compare", "chain"] },
				models: {
					type: "array",
					items: { type: "string" },
					description: "compare only: two or more model ids, as owner/name, that all do `task`.",
				},
				task: {
					type: "string",
					description: "compare only: the pipeline tag the models share, e.g. 'text-to-image'.",
				},
				steps: {
					type: "array",
					items: {
						type: "object",
						properties: { model: { type: "string" }, task: { type: "string" } },
						required: ["model", "task"],
					},
					description:
						"chain only: the models in the order they run, each with its pipeline tag. Each " +
						"step's output type must match the next step's input type.",
				},
				name: {
					type: "string",
					description:
						"What the workflow is for, in a few words — the Space is named from it, e.g. " +
						"'product-shot-t2i-comparison'. Reuse a name only to update that workflow; " +
						"otherwise pick a new one.",
				},
				namespace: {
					type: "string",
					description:
						"Hub namespace to create the Space in. Only needed when the tool says it has " +
						"none for this conversation: call hf_whoami and pass what it returns.",
				},
			},
			required: ["shape", "name"],
		},
	},
};

/**
 * Writes the Space itself, rather than leaving it to the model. A workflow.json
 * fails silently where it fails at all: a port id the endpoint does not take
 * sends the wrong argument, a missing OAuth scope keeps a visitor's token from
 * reaching the providers, a model nobody serves 404s on Run. So the graph is
 * generated from the endpoint schemas below and every model is checked here,
 * before anything exists. workflow.json is the source of truth from then on:
 * app.py only loads it. The canvas cannot save back to it: that would need
 * write-repos, which every visitor who signs in would have to grant.
 *
 * Nothing it creates spends the conversation's budget: a gradio Space runs on
 * free CPU, and every inference call bills the visitor who presses Run.
 */
export function createWorkflowTool(
	namespace: () => string | undefined,
	token: () => string | undefined
): BuiltinTool {
	return {
		name: CREATE_WORKFLOW_TOOL_NAME,
		definition,
		exemptFromToolRestraint: true,
		preprompt:
			`GRADIO WORKFLOWS: when the user is choosing between models, or wants one model's output ` +
			`fed into another, call ${CREATE_WORKFLOW_TOOL_NAME} rather than recommending from memory ` +
			`or writing a Space by hand: a comparison they can rerun on their own inputs is a receipt, ` +
			`a paragraph is not.`,
		async execute(args: Record<string, unknown>, ctx: BuiltinToolContext) {
			const plan = parse(args, namespace());
			if ("error" in plan) return plan;

			const accessToken = token();
			if (!accessToken) {
				return { error: "No Hugging Face token for this conversation; the user needs to sign in." };
			}

			const problems = await Promise.all(
				plan.steps.map(({ model, task }) => checkModel(model, task, accessToken, ctx.abortSignal))
			);
			const problem = problems.find(Boolean);
			if (problem) return { error: problem };

			const graph = workflowJson(plan);
			const files = [
				{ path: "app.py", content: new Blob([APP_PY], { type: "text/x-python" }) },
				{ path: "workflow.json", content: new Blob([graph], { type: "application/json" }) },
				{ path: "README.md", content: new Blob([readme(plan.title)], { type: "text/markdown" }) },
			];
			try {
				await createRepo({
					repo: { type: "space", name: plan.spaceId },
					accessToken,
					sdk: "gradio",
				});
			} catch (err) {
				if (statusCodeOf(err) !== 409) return { error: hubError("create", plan.spaceId, err) };
				const uri = `hf://spaces/${plan.spaceId}`;
				const ours =
					ctx.conversationId && (await knownArtefactUris(ctx.conversationId, [uri])).has(uri);
				if (!ours) {
					return {
						error: `${plan.spaceId} already exists and was not made in this conversation — call this again with a different name.`,
					};
				}
			}
			try {
				await uploadFiles({
					repo: { type: "space", name: plan.spaceId },
					accessToken,
					files,
					commitTitle: "Workflow from ML Intern",
					abortSignal: ctx.abortSignal,
				});
			} catch (err) {
				return { error: hubError("write to", plan.spaceId, err) };
			}

			const url = `https://huggingface.co/spaces/${plan.spaceId}?ui=canvas`;
			if (ctx.conversationId) {
				void recordArtefact({
					conversationId: ctx.conversationId,
					kind: "space",
					uri: `hf://spaces/${plan.spaceId}`,
					url,
					toolUuid: ctx.uuid,
					...(ctx.messageId ? { messageId: ctx.messageId } : {}),
					...(ctx.generationId ? { generationId: ctx.generationId } : {}),
				}).catch((err) => {
					logger.error(
						{ err: String(err), spaceId: plan.spaceId },
						"[mlRegistry] recording the workflow Space failed"
					);
				});
			}

			return {
				resultText: [
					`Public workflow Space written: ${url} — tell the user it is public.`,
					`It runs ${plan.steps.map((step) => step.model).join(plan.shape === "compare" ? " and " : " → ")}.`,
					"",
					"It builds in a minute or two — tell the user it is building, not that it is live.",
					"Every run bills the inference quota of whoever presses Run — signed in through the",
					"Space — not this conversation's budget.",
				].join("\n"),
			};
		},
	};
}

/** `owner`, as the Hub spells one: no slash, no spaces. */
const NAMESPACE = /^[A-Za-z0-9][\w.-]*$/;
/** `owner/name`, nothing that looks like a URL. */
const REPO_ID = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;

interface Plan {
	shape: "compare" | "chain";
	steps: { model: string; task: string }[];
	title: string;
	spaceId: string;
}

function parse(args: Record<string, unknown>, sessionNamespace?: string): Plan | { error: string } {
	const title = typeof args.name === "string" ? args.name.trim() : "";
	if (!title) return { error: "No name provided." };

	let steps: { model: string; task: string }[];
	if (args.shape === "compare") {
		const task = typeof args.task === "string" ? args.task.trim() : "";
		if (!task) return { error: "compare needs the `task` the models share." };
		const models = Array.isArray(args.models) ? args.models : [];
		if (models.length < 2) {
			return {
				error:
					"compare needs at least two models. One model with many inputs is a gr.Interface, " +
					"not a workflow — build that as an ordinary Gradio Space instead.",
			};
		}
		steps = models.map((model) => ({ model: String(model).trim(), task }));
	} else if (args.shape === "chain") {
		const raw = Array.isArray(args.steps) ? args.steps : [];
		if (raw.length < 2) return { error: "chain needs at least two steps." };
		steps = raw.map((step) => ({
			model: String((step as Record<string, unknown>)?.model ?? "").trim(),
			task: String((step as Record<string, unknown>)?.task ?? "").trim(),
		}));
	} else {
		return { error: "shape must be 'compare' or 'chain'." };
	}
	for (const { model, task } of steps) {
		if (!REPO_ID.test(model)) return { error: `"${model}" is not a model id — use owner/name.` };
		if (!PIPELINE_TAG_TO_ENDPOINT[task]) {
			return {
				error: `A workflow cannot call a ${task || "missing"} task. It takes one of: ${Object.keys(PIPELINE_TAG_TO_ENDPOINT).join(", ")}.`,
			};
		}
	}
	for (let i = 1; i < steps.length && args.shape === "chain"; i++) {
		const out = endpointOf(steps[i - 1].task).outputs[0].type;
		const into = endpointOf(steps[i].task).inputs[0].type;
		if (!portsConnect(out, into)) {
			return {
				error:
					`${steps[i - 1].model} outputs ${out}, but ${steps[i].model} takes ${into} — the steps ` +
					`do not connect. Put a step between them that converts, or reorder them.`,
			};
		}
	}

	const given = typeof args.namespace === "string" ? args.namespace.trim() : "";
	if (given && !NAMESPACE.test(given)) {
		return { error: `"${given}" is not a Hub namespace — it is an owner, with no slash.` };
	}
	const namespace = given || sessionNamespace;
	if (!namespace) {
		return {
			error:
				"No Hugging Face namespace for this conversation, so the Space cannot be named. " +
				"Call hf_whoami and call this again with its namespace in the `namespace` argument.",
		};
	}

	// Named from the title, not random, so a rerun updates the same Space. The
	// suffix keeps it off a Space the user named themselves, which a rerun would overwrite.
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, 80)
		.replace(/^-+|-+$/g, "");
	return {
		shape: args.shape,
		steps,
		title,
		spaceId: `${namespace}/${slug || "untitled"}-workflow`,
	};
}

/** A problem worth telling the model about, or undefined when the model is usable. */
async function checkModel(
	model: string,
	task: string,
	accessToken: string,
	signal?: AbortSignal
): Promise<string | undefined> {
	let info: {
		pipeline_tag?: string;
		inferenceProviderMapping?: Record<string, { status?: string; task?: string }>;
	};
	try {
		const response = await fetch(
			`https://huggingface.co/api/models/${model}?expand[]=pipeline_tag&expand[]=inferenceProviderMapping`,
			{ headers: { Authorization: `Bearer ${accessToken}` }, signal }
		);
		if (!response.ok) return `${model} does not resolve on the Hub (${response.status}).`;
		info = await response.json();
	} catch (err) {
		return `Could not look up ${model}: ${String(err)}`;
	}
	if (info.pipeline_tag !== task) {
		return `${model} is a ${info.pipeline_tag ?? "untagged"} model, not ${task}.`;
	}
	const tasks = providerTasks(PIPELINE_TAG_TO_ENDPOINT[task]);
	const live = Object.values(info.inferenceProviderMapping ?? {}).some(
		(p) => p.status === "live" && tasks.includes(p.task ?? "")
	);
	if (!live) {
		return (
			`${model} is not served by any inference provider for ${tasks.join(" or ")}, so a ` +
			`workflow cannot call it — pick another, or deploy it in a Space of its own first.`
		);
	}
	return undefined;
}

const APP_PY = `import gradio as gr

demo = gr.Workflow(graph="workflow.json")

if __name__ == "__main__":
    demo.launch()
`;

type Port = { id: string; label: string; type: string; output_index?: number };
type Endpoint = { inputs: Port[]; outputs: Port[] };

const text = (id: string, label: string): Port => ({ id, label, type: "text" });
const media = (type: string, id = type): Port => ({
	id,
	label: type[0].toUpperCase() + type.slice(1),
	type,
});
const out = (label: string, type: string): Port[] => [
	{ id: "out_0", label, type, output_index: 0 },
];

/**
 * The endpoint schemas `kind: "model"` nodes are called with, copied from
 * `_INFERENCE_ENDPOINT_SCHEMAS` and `_PIPELINE_TAG_TO_ENDPOINT` in gradio's
 * `gradio/workflow.py` at GRADIO_VERSION. With an endpoint set, arguments go as
 * keyword arguments keyed by port id, so these ids are not labels: they are
 * the parameter names, and one that drifts sends the wrong argument.
 */
// ponytail: a copy of gradio's table, bump it with GRADIO_VERSION; read it from gradio if it starts drifting
const ENDPOINTS: Record<string, Endpoint> = {
	text_to_image: { inputs: [text("prompt", "Prompt")], outputs: out("Image", "image") },
	text_to_speech: { inputs: [text("text", "Text")], outputs: out("Audio", "audio") },
	text_to_video: { inputs: [text("prompt", "Prompt")], outputs: out("Video", "video") },
	image_to_image: {
		inputs: [media("image"), text("prompt", "Prompt")],
		outputs: out("Image", "image"),
	},
	image_to_video: {
		inputs: [media("image"), text("prompt", "Prompt")],
		outputs: out("Video", "video"),
	},
	text_generation: { inputs: [text("prompt", "Prompt")], outputs: out("Text", "markdown") },
	summarization: { inputs: [text("text", "Text")], outputs: out("Summary", "text") },
	translation: {
		inputs: [
			text("text", "Text"),
			text("src_lang", "Source Language"),
			text("tgt_lang", "Target Language"),
		],
		outputs: out("Translation", "text"),
	},
	fill_mask: { inputs: [text("text", "Text")], outputs: out("Result", "json") },
	text_classification: { inputs: [text("text", "Text")], outputs: out("Labels", "json") },
	token_classification: { inputs: [text("text", "Text")], outputs: out("Entities", "json") },
	zero_shot_classification: {
		inputs: [text("text", "Text"), text("candidate_labels", "Candidate Labels")],
		outputs: out("Scores", "json"),
	},
	sentence_similarity: {
		inputs: [text("sentence", "Sentence"), text("other_sentences", "Other Sentences")],
		outputs: out("Scores", "json"),
	},
	question_answering: {
		inputs: [text("question", "Question"), text("context", "Context")],
		outputs: out("Answer", "text"),
	},
	feature_extraction: { inputs: [text("text", "Text")], outputs: out("Embeddings", "json") },
	image_classification: { inputs: [media("image")], outputs: out("Labels", "json") },
	object_detection: { inputs: [media("image")], outputs: out("Detections", "json") },
	image_segmentation: { inputs: [media("image")], outputs: out("Segments", "json") },
	automatic_speech_recognition: { inputs: [media("audio")], outputs: out("Text", "text") },
	audio_classification: { inputs: [media("audio")], outputs: out("Labels", "json") },
	chat_completion: {
		inputs: [media("image"), text("text", "Prompt")],
		outputs: out("Answer", "markdown"),
	},
};

const PIPELINE_TAG_TO_ENDPOINT: Record<string, string> = {
	"text-generation": "text_generation",
	"text2text-generation": "text_generation",
	conversational: "text_generation",
	summarization: "summarization",
	translation: "translation",
	"fill-mask": "fill_mask",
	"text-classification": "text_classification",
	"token-classification": "token_classification",
	"zero-shot-classification": "zero_shot_classification",
	"sentence-similarity": "sentence_similarity",
	"question-answering": "question_answering",
	"feature-extraction": "feature_extraction",
	"text-to-image": "text_to_image",
	"text-to-speech": "text_to_speech",
	"text-to-audio": "text_to_speech",
	"text-to-video": "text_to_video",
	"image-to-image": "image_to_image",
	"image-to-video": "image_to_video",
	"image-text-to-video": "image_to_video",
	"image-classification": "image_classification",
	"object-detection": "object_detection",
	"image-segmentation": "image_segmentation",
	"automatic-speech-recognition": "automatic_speech_recognition",
	"audio-classification": "audio_classification",
	"image-text-to-text": "chat_completion",
};

const endpointOf = (task: string): Endpoint => ENDPOINTS[PIPELINE_TAG_TO_ENDPOINT[task]];

function providerTasks(endpoint: string): string[] {
	if (endpoint === "chat_completion") return ["conversational"];
	if (endpoint === "text_generation") return ["text-generation", "conversational"];
	return [endpoint.replaceAll("_", "-")];
}

/** Mirrors `ports_compatible` in gradio's workflow-types.ts: markdown is text to a port. */
function portsConnect(from: string, to: string): boolean {
	if (from === to || from === "any" || to === "any") return true;
	return ["text", "markdown"].includes(from) && ["text", "markdown"].includes(to);
}

/** An input or output tile: a reference is read from `out`, a subject written to `in`. */
function tile(id: string, label: string, role: "reference" | "subject", type: string) {
	return {
		id,
		label,
		role,
		asset_type: type,
		inputs: [{ id: "in", label, type }],
		outputs: [{ id: "out", label, type }],
		data: {},
	};
}

/**
 * The schema-v2 graph: a compare shares one reference per input across every
 * model, a chain wires each output into the next model's first input, and any
 * input nothing feeds gets its own reference, any output nothing reads its own
 * subject. Node ids are readable and stable (op_flux_1_dev), since they are what
 * a user points at on the canvas. No coordinates: the canvas lays it out.
 */
function workflowJson({ shape, steps, title }: Plan): string {
	const names = steps.map((step) => step.model.split("/")[1]);
	const labels = new Set(names).size === names.length ? names : steps.map((step) => step.model);
	const taken = new Set<string>();
	const operators = steps.map(({ model, task }, i) => {
		const base = `op_${
			names[i]
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "_")
				.replace(/^_+|_+$/g, "") || "model"
		}`;
		let id = base;
		for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
		taken.add(id);
		const endpoint = endpointOf(task);
		return {
			id,
			label: labels[i],
			role: "operator",
			kind: "model",
			model_id: model,
			pipeline_tag: task,
			endpoint: PIPELINE_TAG_TO_ENDPOINT[task],
			inputs: endpoint.inputs.map((port) => ({ ...port })),
			outputs: endpoint.outputs.map((port) => ({ ...port })),
			data: {},
		};
	});

	const references: ReturnType<typeof tile>[] = [];
	const subjects: ReturnType<typeof tile>[] = [];
	const edges: Record<string, string>[] = [];
	const edge = (from: string, fromPort: string, to: string, toPort: string, type: string) =>
		edges.push({
			id: `e${edges.length}`,
			from_node_id: from,
			from_port_id: fromPort,
			to_node_id: to,
			to_port_id: toPort,
			type,
		});

	if (shape === "compare") {
		for (const port of operators[0].inputs) {
			references.push(tile(`ref_${port.id}`, port.label, "reference", port.type));
			for (const op of operators) edge(`ref_${port.id}`, "out", op.id, port.id, port.type);
		}
	} else {
		operators.slice(1).forEach((op, i) => {
			const source = operators[i].outputs[0];
			edge(operators[i].id, source.id, op.id, op.inputs[0].id, source.type);
		});
	}

	const fed = new Set(edges.map((e) => `${e.to_node_id}:${e.to_port_id}`));
	const read = new Set(edges.map((e) => `${e.from_node_id}:${e.from_port_id}`));
	for (const op of operators) {
		for (const port of op.inputs) {
			if (fed.has(`${op.id}:${port.id}`)) continue;
			const id = `ref_${op.id}_${port.id}`;
			references.push(tile(id, port.label, "reference", port.type));
			edge(id, "out", op.id, port.id, port.type);
		}
		for (const port of op.outputs) {
			if (read.has(`${op.id}:${port.id}`)) continue;
			// Subjects name the API endpoints, so the model's label is the useful one.
			const id = `sub_${op.id}_${port.id}`;
			subjects.push(tile(id, op.label, "subject", port.type));
			edge(op.id, port.id, id, "in", port.type);
		}
	}

	return JSON.stringify(
		{
			schema_version: "2",
			name: title,
			runtime: { default: "client" },
			references,
			operators,
			subjects,
			edges,
		},
		null,
		2
	);
}

function readme(title: string): string {
	// JSON strings are valid YAML double-quoted scalars, so the title cannot break the front matter.
	return `---
title: ${JSON.stringify(title.slice(0, 200))}
sdk: gradio
sdk_version: ${GRADIO_VERSION}
app_file: app.py
hf_oauth: true
hf_oauth_scopes:
  - inference-api
tags:
  - ml-intern
  - gradio-workflow
---

[![Built with ML Intern](https://huggingface.co/datasets/huggingface/badges/resolve/main/built-with-ml-intern-sm.svg)](https://hf.co/chat?mode=ml-intern)

A [gr.Workflow](https://www.gradio.app/guides/workflows): sign in and press Run to try it on your own input.
`;
}

function statusCodeOf(err: unknown): number | undefined {
	if (err && typeof err === "object" && "statusCode" in err) {
		const code = (err as { statusCode?: unknown }).statusCode;
		return typeof code === "number" ? code : undefined;
	}
	return undefined;
}

function hubError(action: string, spaceId: string, err: unknown): string {
	const status = statusCodeOf(err);
	if (status === 401) {
		return `Not allowed to ${action} ${spaceId}: the user needs to sign in again.`;
	}
	if (status === 403) {
		return `${spaceId} already exists and this app cannot write to it — call this again with a different name.`;
	}
	return `Could not ${action} ${spaceId}: ${String(err)}`;
}
