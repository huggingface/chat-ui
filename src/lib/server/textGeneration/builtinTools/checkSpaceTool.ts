import type { OpenAiTool } from "$lib/server/mcp/tools";
import {
	SPACE_ID,
	fetchGradioEndpoints,
	lookupSpace,
	pickGradioEndpoint,
	readSpaceLogTail,
	type GradioIo,
	type HubSpace,
	type SpaceLogKind,
} from "$lib/server/hubSpaces";
import { CONSOLE_WAITS, consoleSection, type ConsoleWaits } from "$lib/server/spaceConsole/section";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { CHECK_SPACE_TOOL_NAME, spaceCheckHeader } from "$lib/utils/spaceCheck";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types";

export { CHECK_SPACE_TOOL_NAME };

const IN_PROGRESS: Record<string, string> = {
	BUILDING: "It is still building.",
	RUNNING_BUILDING: "A new build is running; the old version serves until it finishes.",
	APP_STARTING: "It built and is starting.",
	RUNNING_APP_STARTING: "A new version built and is starting.",
};

const CALL_TIMEOUT_MS = 90_000;
const OUTPUT_MAX_CHARS = 1500;

const definition: OpenAiTool = {
	type: "function",
	function: {
		name: CHECK_SPACE_TOOL_NAME,
		description:
			"Check a Hugging Face Space you created or changed: its stage, the build or run log " +
			"when it failed, and for a running Gradio Space one test call to its API.\n\n" +
			"A Space is done once this has seen it RUNNING and, for Gradio, the test call " +
			"completed. Until then:\n" +
			"- BUILDING or APP_STARTING: call wait (about 60 s for a build, 30 s to start), then " +
			"call this again.\n" +
			"- BUILD_ERROR, RUNTIME_ERROR or CONFIG_ERROR: fix what the log shows, push, and call " +
			"this again. After two failed fixes, stop and report the stage and the error instead.\n" +
			"- The test call failed: the run log that comes with it usually names the cause.\n\n" +
			"For a running Gradio Space it also opens the Space in the user's browser tab, when " +
			"one is attached, and returns that page's browser console: a blank page or a broken " +
			"frontend shows up there and nowhere else. Entries logged later, while the user uses " +
			"the Space, show up in the next check. The test call runs on the server, so it never " +
			"appears in the console.\n\n" +
			"The test call uses each input's example value unless you pass `inputs`, and runs on " +
			"the Space's hardware like any visitor's call — a ZeroGPU or paid Space spends quota.",
		parameters: {
			type: "object",
			properties: {
				space: { type: "string", description: "The Space id, as owner/name." },
				endpoint: {
					type: "string",
					description:
						"The Gradio api_name to call, e.g. '/predict'. Defaults to /predict or the first " +
						"endpoint that is not a UI event handler.",
				},
				inputs: {
					type: "object",
					description:
						"Inputs for the test call, keyed by parameter name. Any you leave out use the " +
						"Space's example or default value.",
				},
			},
			required: ["space"],
		},
	},
};

export function createCheckSpaceTool(
	token: () => string | undefined,
	consoleWaits: ConsoleWaits = CONSOLE_WAITS
): BuiltinTool {
	return {
		name: CHECK_SPACE_TOOL_NAME,
		definition,
		exemptFromToolRestraint: true,
		async execute(args, ctx) {
			return checkSpace(args, token(), ctx, consoleWaits);
		},
	};
}

async function checkSpace(
	args: Record<string, unknown>,
	token: string | undefined,
	ctx: BuiltinToolContext,
	consoleWaits: ConsoleWaits
): Promise<BuiltinToolResult> {
	const id = typeof args.space === "string" ? args.space.trim() : "";
	if (!SPACE_ID.test(id)) return { error: `"${id}" is not a Space id — use owner/name.` };
	const endpointArg =
		typeof args.endpoint === "string" && args.endpoint.trim()
			? args.endpoint.trim().replace(/^\/?/, "/")
			: undefined;
	const inputs =
		args.inputs && typeof args.inputs === "object" && !Array.isArray(args.inputs)
			? (args.inputs as Record<string, unknown>)
			: {};

	const space = await lookupSpace(id, token, ctx.abortSignal);
	if (typeof space === "string") return { error: space };

	const stage = space.stage ?? "UNKNOWN";
	const header = spaceCheckHeader(id, stage, space.private);
	const lines = [header];
	const done = () => ({ resultText: lines.join("\n") });

	if (IN_PROGRESS[stage]) {
		lines.push(IN_PROGRESS[stage], "Call wait, then check it again.");
		return done();
	}
	if (stage === "BUILD_ERROR" || stage === "RUNTIME_ERROR" || stage === "CONFIG_ERROR") {
		if (space.errorMessage) lines.push("", "Hub error:", clipMiddle(space.errorMessage, 300, 1700));
		if (stage !== "CONFIG_ERROR") {
			lines.push("", ...(await logSection(space, stage === "BUILD_ERROR" ? "build" : "run")));
		}
		return done();
	}
	if (stage === "NO_APP_FILE") {
		lines.push("It has no app file yet: push the file the README's app_file names.");
		return done();
	}
	if (stage === "SLEEPING") {
		if (space.host) {
			// any request wakes it, the response is only the sleeping page
			void fetch(space.host, {
				headers: space.private && token ? { Authorization: `Bearer ${token}` } : {},
				signal: AbortSignal.timeout(10_000),
			}).catch(() => {});
		}
		lines.push("It was asleep and is waking up. Call wait for about 30 s, then check it again.");
		return done();
	}
	if (stage !== "RUNNING") {
		lines.push(`It is not running; only its owner can restart it from the Space settings.`);
		return done();
	}
	if (space.sdk !== "gradio" || !space.host) {
		lines.push(`It is a ${space.sdk ?? "non-Gradio"} Space, so there is no Gradio API to test.`);
		return done();
	}

	// space code can read the authorization header, so only a private space gets the token
	const hostToken = space.private ? token : undefined;

	// the tab loads the page while the api is tested here
	const browser = openInBrowser();
	const finish = async () => {
		if (browser) lines.push("", ...(await browser));
		return done();
	};
	const named = await fetchGradioEndpoints(space, hostToken, ctx.abortSignal);
	if (typeof named === "string") {
		lines.push(named, "", ...(await logSection(space, "run")));
		return finish();
	}
	const endpoint = pickGradioEndpoint(id, named, endpointArg);
	if (typeof endpoint !== "string") {
		lines.push(endpoint.error);
		return finish();
	}
	const data = callData(named[endpoint].parameters ?? [], inputs);
	if ("missing" in data) {
		lines.push(
			`${endpoint} needs ${data.missing.join(", ")}, which have no example value: pass them in \`inputs\`.`
		);
		return finish();
	}

	const outcome = await callGradio(space, endpoint, data.values, hostToken, ctx.abortSignal);
	lines.push("", `Test call to ${endpoint} with ${clip(JSON.stringify(data.values), 400)}:`);
	if (outcome.ok) {
		lines.push(`completed → ${clip(outcome.output, OUTPUT_MAX_CHARS)}`);
	} else {
		lines.push(`failed: ${outcome.error}`, "", ...(await logSection(space, "run")));
	}
	return finish();

	function openInBrowser(): Promise<string[]> | undefined {
		if (!ctx.conversationId) return undefined;
		if (!ctx.elicitationSink) {
			return Promise.resolve([
				"Console: no browser tab is attached to this run, so its browser console can't be read.",
			]);
		}
		// progress is never stored, so only a tab watching this run opens the pane
		ctx.elicitationSink.emit({
			type: MessageUpdateType.Tool,
			subtype: MessageToolUpdateType.Progress,
			uuid: ctx.uuid,
			progress: 0,
			message: header,
		});
		return consoleSection({
			conversationId: ctx.conversationId,
			spaceId: id,
			checkId: ctx.uuid,
			signal: ctx.abortSignal,
			waits: consoleWaits,
		});
	}

	async function logSection(target: HubSpace, kind: SpaceLogKind): Promise<string[]> {
		if (!token) return [`No sign-in, so the ${kind} log cannot be read.`];
		const tail = await readSpaceLogTail(target.id, kind, token, { signal: ctx.abortSignal });
		if ("error" in tail) return [tail.error];
		if (!tail.lines.length) return [`The ${kind} log is empty.`];
		return [`Last ${tail.lines.length} lines of the ${kind} log:`, ...tail.lines];
	}
}

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…[${text.length - max} more chars]` : text;
}

/** keeps the tail, where a traceback names its cause */
function clipMiddle(text: string, head: number, tail: number): string {
	if (text.length <= head + tail) return text;
	return `${text.slice(0, head)}\n…[${text.length - head - tail} chars cut]…\n${text.slice(-tail)}`;
}

/** given input, else the example, else the parameter default */
function callData(
	parameters: GradioIo[],
	inputs: Record<string, unknown>
): { values: unknown[] } | { missing: string[] } {
	const values: unknown[] = [];
	const missing: string[] = [];
	parameters.forEach((p, i) => {
		const name = p.parameter_name ?? p.label ?? `input ${i}`;
		if (Object.hasOwn(inputs, name)) values.push(inputs[name]);
		// gradio writes ... for an input with no example, such as a gr.api filepath
		else if (p.example_input !== undefined && p.example_input !== "...")
			values.push(p.example_input);
		else if (p.parameter_has_default) values.push(p.parameter_default ?? null);
		else missing.push(name);
	});
	return missing.length ? { missing } : { values };
}

type CallOutcome = { ok: true; output: string } | { ok: false; error: string };

/** the post returns an event id whose stream ends in complete or error */
async function callGradio(
	space: HubSpace,
	endpoint: string,
	data: unknown[],
	token: string | undefined,
	signal?: AbortSignal
): Promise<CallOutcome> {
	const url = `${space.host}/gradio_api/call/${encodeURIComponent(endpoint.replace(/^\//, ""))}`;
	const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
	const deadline = AbortSignal.any([
		...(signal ? [signal] : []),
		AbortSignal.timeout(CALL_TIMEOUT_MS),
	]);

	let eventId: unknown;
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { ...auth, "Content-Type": "application/json" },
			body: JSON.stringify({ data }),
			signal: deadline,
		});
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			return { ok: false, error: `the call was refused (${response.status}) ${clip(body, 300)}` };
		}
		eventId = ((await response.json()) as { event_id?: unknown }).event_id;
	} catch (err) {
		return { ok: false, error: `could not start the call: ${String(err)}` };
	}
	if (typeof eventId !== "string" || !eventId) {
		return { ok: false, error: "the Space returned no event id" };
	}

	let event = "";
	let last: string | undefined;
	try {
		const response = await fetch(`${url}/${encodeURIComponent(eventId)}`, {
			headers: { ...auth, Accept: "text/event-stream" },
			signal: deadline,
		});
		if (!response.ok || !response.body) {
			return { ok: false, error: `could not read the result (${response.status})` };
		}
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split("\n");
				buffer = parts.pop() ?? "";
				for (const line of parts) {
					if (line.startsWith("event:")) event = line.slice(6).trim();
					else if (line.startsWith("data:")) {
						const payload = line.slice(5).trim();
						if (event === "complete") return { ok: true, output: payload };
						if (event === "error") return { ok: false, error: gradioError(payload) };
						if (event === "generating") last = payload;
					}
				}
			}
		} finally {
			reader.cancel().catch(() => {});
		}
	} catch (err) {
		if (signal?.aborted) return { ok: false, error: "aborted" };
		const partial = last ? ` Last partial output: ${clip(last, 400)}` : "";
		return {
			ok: false,
			error: `no result within ${CALL_TIMEOUT_MS / 1000} s (${String(err)}).${partial}`,
		};
	}
	return { ok: false, error: "the result stream ended without a result" };
}

/** gradio sends a null error when the app raised without gr.Error, which is most of the time */
function gradioError(payload: string): string {
	try {
		const parsed = JSON.parse(payload);
		const message = parsed && typeof parsed === "object" ? parsed.error : parsed;
		if (typeof message === "string" && message) return message;
	} catch {
		if (payload && payload !== "null") return clip(payload, 600);
	}
	return "the app raised an exception without a message";
}
