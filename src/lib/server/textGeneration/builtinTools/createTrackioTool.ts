import type { OpenAiTool } from "$lib/server/mcp/tools";
import { trackioSpaceId } from "$lib/server/trackioSpace";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types";

export const CREATE_TRACKIO_TOOL_NAME = "create_trackio";

const definition: OpenAiTool = {
	type: "function",
	function: {
		name: CREATE_TRACKIO_TOOL_NAME,
		description:
			"Reserve the Trackio dashboard for a training run and get back the exact space_id to " +
			"pass to trackio.init(). Call this before you submit a training job, then use the id it " +
			"returns verbatim — the dashboard shown to the user is that Space and no other, so an " +
			"id you invent instead will leave the user watching a dashboard the run never writes to.",
		parameters: {
			type: "object",
			properties: {
				project: {
					type: "string",
					description:
						"What is being trained, in a few words — used for the project name and the " +
						"Space, e.g. 'smollm2-capybara-sft'.",
				},
				namespace: {
					type: "string",
					description:
						"Hub namespace to create the Space in. Only needed when the tool says it has " +
						"none for this conversation: call hf_whoami and pass what it returns.",
				},
			},
			required: ["project"],
		},
	},
};

/**
 * Names the dashboard so chat-ui knows it without reading anything the model
 * wrote.
 *
 * The Space itself is created by `trackio.init` inside the training job — its
 * own deploy path, so the layout and version are right by construction. A Space
 * built any other way answers init and then refuses every write. Nothing is
 * submitted here: a builtin that dispatched its own job would spend outside the
 * budget gate, which is the one thing a tool at this level must not do.
 */
export function createTrackioTool(namespace: () => string | undefined): BuiltinTool {
	return {
		name: CREATE_TRACKIO_TOOL_NAME,
		definition,
		exemptFromToolRestraint: true,
		preprompt:
			`TRACKIO DASHBOARDS: ${CREATE_TRACKIO_TOOL_NAME} reserves the dashboard and returns the ` +
			`space_id to use. Call it before submitting a training job and pass that id to ` +
			`trackio.init(space_id=...) exactly as given. The user's dashboard is wired to that Space ` +
			`from the moment you call this, so it fills in as the run logs — an id you chose yourself ` +
			`instead points them at a Space nothing writes to.`,
		async execute(args: Record<string, unknown>, _ctx: BuiltinToolContext) {
			return reserve(args, namespace());
		},
	};
}

/** `owner`, as the Hub spells one: no slash, no spaces. */
const NAMESPACE = /^[A-Za-z0-9][\w.-]*$/;

function reserve(args: Record<string, unknown>, sessionNamespace?: string): BuiltinToolResult {
	const project = typeof args.project === "string" ? args.project.trim() : "";
	if (!project) return { error: "No project name provided." };

	const given = typeof args.namespace === "string" ? args.namespace.trim() : "";
	if (given && !NAMESPACE.test(given)) {
		return { error: `"${given}" is not a Hub namespace — it is an owner, with no slash.` };
	}
	// The session's namespace is captured when the tool is built, so a run that
	// started without one can only be rescued by being handed one.
	const namespace = given || sessionNamespace;
	if (!namespace) {
		return {
			error:
				"No Hugging Face namespace for this conversation, so the dashboard cannot be named. " +
				"Call hf_whoami and call this again with its namespace in the `namespace` argument.",
		};
	}

	const spaceId = trackioSpaceId(namespace, project);

	// The Hub form, not the embed origin: it carries `owner/name`, which is what
	// lets the chip poll for readiness. The URL here is chat-ui's own, which is
	// what makes it safe to frame — see TRACKIO_SOURCE_TOOL_REGEX.
	return {
		resultText: [
			`Trackio dashboard reserved: https://huggingface.co/spaces/${spaceId}`,
			"",
			`Use these exact values, unchanged:`,
			`  trackio.init(project=${JSON.stringify(project)}, space_id=${JSON.stringify(spaceId)})`,
			"",
			`Add trackio to the job's dependencies at the current release — resolve it and pin that`,
			`exact version, the same as every other dependency. The Space is created by trackio on the`,
			`first init, so it appears once the run reaches that line — the user's dashboard is`,
			`already pointed at it and fills in from there.`,
		].join("\n"),
	};
}
