import type { OpenAiTool } from "$lib/server/mcp/tools";
import type { Message } from "$lib/types/Message";
import { collectTrackioDashboards } from "$lib/utils/trackio";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types";

export const READ_TRACKIO_TOOL_NAME = "read_trackio";

const MAX_SERIES = 24;
const DEFAULT_POINTS = 40;
const MAX_POINTS = 200;
const REQUEST_TIMEOUT_MS = 20_000;

const definition: OpenAiTool = {
	type: "function",
	function: {
		name: READ_TRACKIO_TOOL_NAME,
		description:
			"Read logged metric values from this conversation's Trackio dashboard: for each run and " +
			"metric, a summary (first, last, min, max, mean, with the steps they occur at) and an " +
			"evenly downsampled series. Use it to answer questions about a dashboard view the user " +
			"attached, or to check a run's metrics. Values are raw, not smoothed. Ranges apply to " +
			"the step axis.",
		parameters: {
			type: "object",
			properties: {
				project: { type: "string", description: "Trackio project name." },
				runs: {
					type: "array",
					items: { type: "string" },
					description: "Run names, as the dashboard view lists them.",
				},
				metrics: {
					type: "array",
					items: { type: "string" },
					description: "Metric names, e.g. 'train/loss'.",
				},
				x_min: { type: "number", description: "First step to include. Omit for the start." },
				x_max: { type: "number", description: "Last step to include. Omit for the end." },
				max_points: {
					type: "integer",
					description: `Points per series in the downsampled output (default ${DEFAULT_POINTS}, at most ${MAX_POINTS}).`,
				},
				dashboard: {
					type: "string",
					description:
						"The dashboard URL from a trackio_dashboard_view block. Omit to use the dashboard " +
						"of the latest attached view, or else the latest dashboard in the conversation.",
				},
			},
			required: ["project", "runs", "metrics"],
		},
	},
};

type MessagesSource = () => Array<Pick<Message, "id" | "from" | "updates" | "dashboardViews">>;

interface Point {
	step: number;
	value: number;
}

function stringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((v): v is string => typeof v === "string" && !!v.trim()))];
}

function finite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Which dashboard to read. Only one the conversation's own tool output
 * produced — the same allowlist that decides what the pane may frame — so a
 * model-supplied URL can never point this at an arbitrary host.
 */
function resolveDashboard(messages: ReturnType<MessagesSource>, requested?: string) {
	const known = collectTrackioDashboards(messages).map((d) => d.url);
	if (requested) return known.includes(requested) ? requested : undefined;
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const views = messages[i].dashboardViews;
		const url = views?.[views.length - 1]?.dashboardUrl;
		if (url && known.includes(url)) return url;
	}
	return known.at(-1);
}

export function downsample<T>(rows: T[], maxPoints: number): T[] {
	if (rows.length <= maxPoints) return rows;
	if (maxPoints <= 1) return rows.slice(-1);
	const last = rows.length - 1;
	const picked = new Set<number>();
	for (let i = 0; i < maxPoints; i += 1) picked.add(Math.round((i * last) / (maxPoints - 1)));
	return [...picked].sort((a, b) => a - b).map((i) => rows[i]);
}

export function summarizeSeries(points: Point[], maxPoints: number) {
	if (!points.length) return { points: 0 };
	let min = points[0];
	let max = points[0];
	let sum = 0;
	for (const p of points) {
		if (p.value < min.value) min = p;
		if (p.value > max.value) max = p;
		sum += p.value;
	}
	const round = (n: number) => Number(n.toPrecision(6));
	return {
		points: points.length,
		first: { step: points[0].step, value: round(points[0].value) },
		last: { step: points[points.length - 1].step, value: round(points[points.length - 1].value) },
		min: { step: min.step, value: round(min.value) },
		max: { step: max.step, value: round(max.value) },
		mean: round(sum / points.length),
		series: downsample(points, maxPoints).map((p) => [p.step, round(p.value)]),
	};
}

async function fetchMetricValues(
	origin: string,
	body: Record<string, unknown>,
	token: string | undefined,
	signal: AbortSignal
): Promise<Point[]> {
	const response = await fetch(`${origin}/api/get_metric_values`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify(body),
		signal,
	});
	const text = await response.text();
	let parsed: { data?: unknown; error?: unknown } | undefined;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(
			response.ok
				? "the dashboard did not answer with JSON (is the Space still starting?)"
				: `HTTP ${response.status} (is the Space still starting, or private?)`
		);
	}
	if (!response.ok || parsed?.error) {
		throw new Error(String(parsed?.error ?? `HTTP ${response.status}`));
	}
	if (!Array.isArray(parsed?.data)) return [];
	const points: Point[] = [];
	for (const row of parsed.data) {
		const step = finite((row as { step?: unknown })?.step);
		const value = finite((row as { value?: unknown })?.value);
		if (step !== undefined && value !== undefined) points.push({ step, value });
	}
	return points.sort((a, b) => a.step - b.step);
}

async function read(
	args: Record<string, unknown>,
	ctx: BuiltinToolContext,
	messages: ReturnType<MessagesSource>,
	token: string | undefined
): Promise<BuiltinToolResult> {
	const project = typeof args.project === "string" ? args.project.trim() : "";
	const runs = stringList(args.runs);
	const metrics = stringList(args.metrics);
	if (!project) return { error: "No project given." };
	if (!runs.length || !metrics.length) return { error: "Give at least one run and one metric." };
	if (runs.length * metrics.length > MAX_SERIES) {
		return {
			error: `That is ${runs.length * metrics.length} run/metric pairs; read at most ${MAX_SERIES} per call.`,
		};
	}

	const requested = typeof args.dashboard === "string" ? args.dashboard.trim() : undefined;
	const dashboard = resolveDashboard(messages, requested || undefined);
	if (!dashboard) {
		return {
			error: requested
				? `${requested} is not a dashboard from this conversation.`
				: "This conversation has no Trackio dashboard yet.",
		};
	}
	const origin = new URL(dashboard).origin;

	const xMin = finite(args.x_min);
	const xMax = finite(args.x_max);
	if (xMin !== undefined && xMax !== undefined && xMin > xMax) {
		return { error: "x_min is greater than x_max." };
	}
	const maxPoints = Math.min(
		MAX_POINTS,
		Math.max(2, Math.round(finite(args.max_points) ?? DEFAULT_POINTS))
	);

	// get_metric_values filters by a centre and a half-width; the window is
	// widened by one so rounding never drops an end, then trimmed exactly below.
	const range =
		xMin !== undefined || xMax !== undefined
			? (() => {
					const lo = xMin ?? 0;
					const hi = xMax ?? Number.MAX_SAFE_INTEGER / 2;
					return {
						around_step: Math.floor((lo + hi) / 2),
						window: Math.ceil((hi - lo) / 2) + 1,
					};
				})()
			: {};

	const signals = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)];
	if (ctx.abortSignal) signals.push(ctx.abortSignal);
	const signal = AbortSignal.any(signals);

	const pairs = runs.flatMap((run) => metrics.map((metric) => ({ run, metric })));
	const results = await Promise.all(
		pairs.map(async ({ run, metric }) => {
			try {
				// max_points is not sent: dashboards before Trackio 0.39 reject the
				// argument outright, and trimming here works against every version.
				const points = (
					await fetchMetricValues(
						origin,
						{ project, run, metric_name: metric, ...range },
						token,
						signal
					)
				).filter(
					(p) => (xMin === undefined || p.step >= xMin) && (xMax === undefined || p.step <= xMax)
				);
				return { run, metric, ...summarizeSeries(points, maxPoints) };
			} catch (error) {
				if (ctx.abortSignal?.aborted) throw error;
				return { run, metric, error: error instanceof Error ? error.message : String(error) };
			}
		})
	);

	if (results.every((r) => "error" in r)) {
		return {
			error: `Could not read ${dashboard}: ${(results[0] as { error: string }).error}`,
		};
	}

	const rangeLabel =
		xMin === undefined && xMax === undefined
			? "all steps"
			: `steps ${xMin ?? "start"}–${xMax ?? "end"}`;
	return {
		resultText: [
			`Trackio ${dashboard} · project ${project} · ${rangeLabel} · raw values, series downsampled to at most ${maxPoints} points as [step, value]`,
			JSON.stringify(results),
		].join("\n"),
	};
}

export function createReadTrackioTool(
	messages: MessagesSource,
	token: () => string | undefined
): BuiltinTool {
	return {
		name: READ_TRACKIO_TOOL_NAME,
		definition,
		exemptFromToolRestraint: true,
		preprompt:
			`DASHBOARD VIEWS: a user message can carry a <trackio_dashboard_view> block — the ` +
			`Trackio dashboard as they were looking at it: project, runs, x-axis and zoomed range, and ` +
			`the charts on screen. It holds coordinates, not values. When they ask about a view, call ` +
			`${READ_TRACKIO_TOOL_NAME} with its project, runs and on-screen metrics, and its range as ` +
			`x_min/x_max, then answer from the numbers it returns. The charts they saw are smoothed; ` +
			`the values you read are raw.`,
		async execute(args: Record<string, unknown>, ctx: BuiltinToolContext) {
			return read(args, ctx, messages(), token());
		},
	};
}
