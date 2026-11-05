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
			"(shape 'compare'), or feeds each model's output into the next (shape 'chain'). A step " +
			"is a model served by an inference provider, or a running Gradio Space — use a Space " +
			"for a model no provider serves. Every step is checked against the Hub first, and " +
			"nothing is written unless all of them pass. Returns the Space URL.",
		parameters: {
			type: "object",
			properties: {
				shape: { type: "string", enum: ["compare", "chain"] },
				models: {
					type: "array",
					items: { type: "string" },
					description: "compare only: model ids, as owner/name, that all do `task`.",
				},
				spaces: {
					type: "array",
					items: {
						type: "object",
						properties: { space: { type: "string" }, endpoint: { type: "string" } },
						required: ["space"],
					},
					description:
						"compare only: Gradio Spaces, as owner/name, to run on the same input as `models`. " +
						"`endpoint` is the api_name to call; it defaults to /predict or the first one. " +
						"`models` and `spaces` together need at least two entries.",
				},
				task: {
					type: "string",
					description: "compare only: the pipeline tag the models share, e.g. 'text-to-image'.",
				},
				steps: {
					type: "array",
					items: {
						type: "object",
						properties: {
							model: { type: "string" },
							task: { type: "string" },
							space: { type: "string" },
							endpoint: { type: "string" },
						},
					},
					description:
						"chain only: the steps in the order they run — each a `model` with its pipeline " +
						"`task`, or a Gradio `space` with an optional `endpoint`. Each step's output type " +
						"must match an input of the next step.",
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
 * Writes the Space itself rather than leaving it to the model: a bad workflow.json
 * fails silently, so the graph is generated from the schemas below and every node
 * checked before anything exists.
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

			const checks = await Promise.all(
				plan.steps.map((step) =>
					"space" in step
						? checkSpace(step, accessToken, ctx.abortSignal)
						: checkModel(step, accessToken, ctx.abortSignal)
				)
			);
			const problem = checks.find((check) => typeof check === "string");
			if (problem) return { error: problem };
			const resolved = checks as Operator[];

			for (let i = 1; i < resolved.length && plan.shape === "chain"; i++) {
				const out = resolved[i - 1].outputs[0]?.type;
				if (!out) {
					return { error: `${repoOf(plan.steps[i - 1])} returns nothing to feed the next step.` };
				}
				if (feedPort(out, resolved[i].inputs, [])) continue;
				const takes = new Set(resolved[i].inputs.filter(isRequired).map((port) => port.type));
				return {
					error:
						`${repoOf(plan.steps[i - 1])} outputs ${out}, but ${repoOf(plan.steps[i])} takes ` +
						`${[...takes].join(" or ") || "no input"} — the steps do not connect. Put a step ` +
						`between them that converts, or reorder them.`,
				};
			}

			const graph = workflowJson(plan, resolved);
			const files = [
				{ path: "app.py", content: new Blob([APP_PY], { type: "text/x-python" }) },
				{ path: "workflow.json", content: new Blob([graph], { type: "application/json" }) },
				{ path: "README.md", content: new Blob([readme(plan.title)], { type: "text/markdown" }) },
			];
			const url = `https://huggingface.co/spaces/${plan.spaceId}?ui=canvas`;
			try {
				await createRepo({
					repo: { type: "space", name: plan.spaceId },
					accessToken,
					sdk: "gradio",
				});

				if (ctx.conversationId) {
					await recordArtefact({
						conversationId: ctx.conversationId,
						kind: "space",
						uri: `hf://spaces/${plan.spaceId}`,
						url,
						toolUuid: ctx.uuid,
						messageId: ctx.messageId,
						generationId: ctx.generationId,
					}).catch((err) => {
						logger.error(
							{ err: String(err), spaceId: plan.spaceId },
							"[mlRegistry] recording the workflow Space failed"
						);
					});
				}
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

			return {
				resultText: [
					`Public workflow Space written: ${url} — tell the user it is public, and link it`,
					"exactly as written: `?ui=canvas` opens it on the canvas.",
					`It runs ${plan.steps.map(repoOf).join(plan.shape === "compare" ? " and " : " → ")}.`,
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

type ModelStep = { model: string; task: string };
type SpaceStep = { space: string; endpoint?: string };
type Step = ModelStep | SpaceStep;

const repoOf = (step: Step) => ("space" in step ? step.space : step.model);

function spaceStep(raw: unknown): SpaceStep {
	const { space, endpoint } = (raw ?? {}) as Record<string, unknown>;
	const name = typeof endpoint === "string" ? endpoint.trim().replace(/^\/?/, "/") : "";
	return { space: String(space ?? "").trim(), ...(name.length > 1 ? { endpoint: name } : {}) };
}

interface Plan {
	shape: "compare" | "chain";
	steps: Step[];
	title: string;
	spaceId: string;
}

function parse(args: Record<string, unknown>, sessionNamespace?: string): Plan | { error: string } {
	const title = typeof args.name === "string" ? args.name.trim() : "";
	if (!title) return { error: "No name provided." };

	let steps: Step[];
	if (args.shape === "compare") {
		const task = typeof args.task === "string" ? args.task.trim() : "";
		const models = Array.isArray(args.models) ? args.models : [];
		const spaces = Array.isArray(args.spaces) ? args.spaces : [];
		if (models.length + spaces.length < 2) {
			return {
				error:
					"compare needs at least two models or Spaces. One model with many inputs is a " +
					"gr.Interface, not a workflow — build that as an ordinary Gradio Space instead.",
			};
		}
		if (models.length && !task) return { error: "compare needs the `task` the models share." };
		steps = [
			...models.map((model) => ({ model: String(model).trim(), task })),
			...spaces.map(spaceStep),
		];
	} else if (args.shape === "chain") {
		const raw = Array.isArray(args.steps) ? args.steps : [];
		if (raw.length < 2) {
			return {
				error:
					`chain needs a \`steps\` array of at least two steps, got ${raw.length}. For example: ` +
					`steps: [{"space": "owner/name", "endpoint": "/predict"}, {"model": "owner/name", "task": "text-to-image"}]`,
			};
		}
		steps = raw.map((step) => {
			const { model, task, space } = (step ?? {}) as Record<string, unknown>;
			if (space !== undefined) return spaceStep(step);
			return { model: String(model ?? "").trim(), task: String(task ?? "").trim() };
		});
	} else {
		return { error: "shape must be 'compare' or 'chain'." };
	}
	for (const step of steps) {
		if (!REPO_ID.test(repoOf(step))) {
			const kind = "space" in step ? "Space" : "model";
			return { error: `"${repoOf(step)}" is not a ${kind} id — use owner/name.` };
		}
		if ("task" in step && !PIPELINE_TAG_TO_ENDPOINT[step.task]) {
			return {
				error: `A workflow cannot call a ${step.task || "missing"} task. It takes one of: ${Object.keys(PIPELINE_TAG_TO_ENDPOINT).join(", ")}.`,
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

/** What an operator node needs beyond its id and label. */
type Operator = {
	kind: "model" | "space";
	fields: Record<string, unknown>;
	inputs: Port[];
	outputs: Port[];
};

/** A problem worth telling the model about, or the node that calls it. */
async function checkModel(
	{ model, task }: ModelStep,
	accessToken: string,
	signal?: AbortSignal
): Promise<string | Operator> {
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

	const own = info.pipeline_tag ?? "";
	if (PIPELINE_TAG_TO_ENDPOINT[own] !== PIPELINE_TAG_TO_ENDPOINT[task]) {
		return `${model} is a ${own || "untagged"} model, not ${task}.`;
	}
	const tasks = providerTasks(PIPELINE_TAG_TO_ENDPOINT[task]);
	const providers = Object.entries(info.inferenceProviderMapping ?? {})
		.filter(([, p]) => p.status === "live" && (tasks.includes(p.task ?? "") || p.task === own))
		.map(([name]) => name)
		.sort((a, b) => Number(b === "hf-inference") - Number(a === "hf-inference"));
	if (!providers.length) {
		return (
			`${model} is not served by any inference provider for ${tasks.join(" or ")}, so a ` +
			`workflow cannot call it — pick another, or pass a running Gradio Space that serves ` +
			`it as a \`space\` step.`
		);
	}
	const endpoint = endpointOf(task);
	return {
		kind: "model",
		fields: {
			model_id: model,
			pipeline_tag: task,
			endpoint: PIPELINE_TAG_TO_ENDPOINT[task],
			provider: providers[0],
		},
		inputs: endpoint.inputs.map((port) => ({ ...port })),
		outputs: endpoint.outputs.map((port) => ({ ...port })),
	};
}

/** Endpoints a Gradio app wires to its own UI events rather than offers as an API. */
const UTILITY_ENDPOINT = /^\/(on|handle|update|prepare|load|clear|reset)_/;

type GradioIo = {
	label?: string;
	parameter_name?: string;
	component?: string;
	parameter_has_default?: boolean;
	parameter_default?: unknown;
};

const COMPONENT_PORTS: Record<string, string> = {
	textbox: "text",
	dropdown: "text",
	radio: "text",
	code: "text",
	markdown: "markdown",
	html: "html",
	number: "number",
	slider: "number",
	checkbox: "boolean",
	image: "image",
	imageeditor: "image",
	gallery: "gallery",
	audio: "audio",
	video: "video",
	file: "file",
	model3d: "model3d",
	json: "json",
	dataframe: "json",
	chatbot: "json",
	label: "json",
	imageslider: "json",
};
const portType = (io: GradioIo) => COMPONENT_PORTS[(io.component ?? "").toLowerCase()] ?? "any";

async function checkSpace(
	{ space, endpoint }: SpaceStep,
	accessToken: string,
	signal?: AbortSignal
): Promise<string | Operator> {
	let named: Record<string, { parameters?: GradioIo[]; returns?: GradioIo[] }>;
	try {
		const response = await fetch(`https://huggingface.co/api/spaces/${space}`, {
			headers: { Authorization: `Bearer ${accessToken}` },
			signal,
		});
		if (!response.ok) return `${space} does not resolve on the Hub (${response.status}).`;
		const info: { sdk?: string; host?: string; runtime?: { stage?: string } } =
			await response.json();
		if (info.sdk !== "gradio") {
			return `${space} is a ${info.sdk ?? "non-Gradio"} Space; a workflow can only call a Gradio Space.`;
		}
		if (info.runtime?.stage !== "RUNNING" || !info.host) {
			return `${space} is ${info.runtime?.stage ?? "not running"}, so a workflow cannot call it — pick a running Space.`;
		}
		// No token: the Space's own code would read it.
		const api = await fetch(`${info.host}/gradio_api/info`, {
			signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]),
		});
		if (!api.ok) return `${space} does not expose a Gradio API (${api.status}).`;
		named = (await api.json()).named_endpoints ?? {};
	} catch (err) {
		return `Could not look up ${space}: ${String(err)}`;
	}
	// Utility endpoints are only skipped when picking a default; one named explicitly is used.
	const names = Object.keys(named).filter((name) => !UTILITY_ENDPOINT.test(name));
	const name = endpoint ?? (names.includes("/predict") ? "/predict" : names[0]);
	if (!name || !Object.hasOwn(named, name)) {
		return `${space} has no ${endpoint ?? "callable"} endpoint${names.length ? ` — it has ${names.join(", ")}` : ""}.`;
	}
	const { parameters = [], returns = [] } = named[name];
	return {
		kind: "space",
		fields: { space_id: space, endpoint: name },
		inputs: parameters.map((p, i) => ({
			id: `in_${i}`,
			label: p.label || p.parameter_name || `Input ${i}`,
			type: portType(p),
			required: !p.parameter_has_default,
			...(p.parameter_has_default ? { default_value: p.parameter_default } : {}),
		})),
		outputs: returns.map((r, i) => ({
			id: `out_${i}`,
			label: r.label || `Output ${i}`,
			type: portType(r),
			output_index: i,
		})),
	};
}

const APP_PY = `import gradio as gr

demo = gr.Workflow(graph="workflow.json")

if __name__ == "__main__":
    demo.launch()
`;

type Port = {
	id: string;
	label: string;
	type: string;
	output_index?: number;
	required?: boolean;
	default_value?: unknown;
};
type Endpoint = { inputs: Port[]; outputs: Port[] };

const isRequired = (port: Port) => port.required !== false;

const text = (id: string, label: string, required?: false): Port => ({
	id,
	label,
	type: "text",
	...(required === false ? { required } : {}),
});
const media = (type: string, id = type): Port => ({
	id,
	label: type[0].toUpperCase() + type.slice(1),
	type,
});
const out = (label: string, type: string): Port[] => [
	{ id: "out_0", label, type, output_index: 0 },
];

/**
 * Copied from `_INFERENCE_ENDPOINT_SCHEMAS` and `_PIPELINE_TAG_TO_ENDPOINT` in
 * gradio's `gradio/workflow.py`. Port ids are the keyword argument names.
 */
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
			text("src_lang", "Source Language", false),
			text("tgt_lang", "Target Language", false),
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

function feedPort(from: string, inputs: Port[], fed: string[]): Port | undefined {
	return inputs.find((p) => isRequired(p) && !fed.includes(p.id) && portsConnect(from, p.type));
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
 * The schema-v2 graph: a compare shares references across steps, a chain wires
 * each output into the next step. Unfed required inputs get a reference.
 */
function workflowJson({ shape, steps, title }: Plan, resolved: Operator[]): string {
	const names = steps.map((step) => repoOf(step).split("/")[1]);
	const labels = new Set(names).size === names.length ? names : steps.map(repoOf);
	const taken = new Set<string>();
	const operators = resolved.map(({ kind, fields, inputs, outputs }, i) => {
		const base = `op_${
			names[i]
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "_")
				.replace(/^_+|_+$/g, "") || "model"
		}`;
		let id = base;
		for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
		taken.add(id);
		return { id, label: labels[i], role: "operator", kind, ...fields, inputs, outputs, data: {} };
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

	const fedPorts = (opId: string) =>
		edges.filter((e) => e.to_node_id === opId).map((e) => e.to_port_id);
	if (shape === "compare") {
		for (const port of operators[0].inputs.filter(isRequired)) {
			const ref = `ref_${port.id}`;
			references.push(tile(ref, port.label, "reference", port.type));
			for (const op of operators) {
				const into = feedPort(port.type, op.inputs, fedPorts(op.id));
				if (into) edge(ref, "out", op.id, into.id, port.type);
			}
		}
	} else {
		operators.slice(1).forEach((op, i) => {
			const source = operators[i].outputs[0];
			const into = feedPort(source.type, op.inputs, []);
			if (into) edge(operators[i].id, source.id, op.id, into.id, source.type);
		});
	}

	const fed = new Set(edges.map((e) => `${e.to_node_id}:${e.to_port_id}`));
	const read = new Set(edges.map((e) => `${e.from_node_id}:${e.from_port_id}`));
	for (const op of operators) {
		for (const port of op.inputs) {
			if (fed.has(`${op.id}:${port.id}`) || !isRequired(port)) continue;
			const id = `ref_${op.id}_${port.id}`;
			references.push(tile(id, port.label, "reference", port.type));
			edge(id, "out", op.id, port.id, port.type);
		}

		for (const port of op.outputs.slice(0, 1)) {
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

const statusCodeOf = (err: unknown) => (err as { statusCode?: number } | null)?.statusCode;

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
