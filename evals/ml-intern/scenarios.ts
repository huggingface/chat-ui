/**
 * ml intern outcome eval tasks, every one but the control a trap the obvious first attempt falls into
 * calibrate a new trap before relying on it, see README.md
 */

export interface ScenarioModel {
	/** Router model id. */
	id: string;
	/** Inference provider, pinned so a run does not drift between providers. */
	provider: string;
}

/** what the user should be able to open when the run ends */
export type ArtifactKind = "model" | "tokenizer" | "space" | "trackio";

/** the production measures from evals/metrics/metrics.py */
export interface ConversationMetrics {
	jobs: number;
	gpu_jobs: number;
	failed: number;
	completed: number;
	longest_failed_streak: number;
	failed_before_first_success: number;
	jobs_to_first_success: number | "";
	sandbox_creates: number;
	gpu_sandbox_creates: number;
	sandbox_before_first_gpu_job: number | "";
	sandbox_on_flavor_before_first_gpu_job: number | "";
	after_failure_sandbox: number;
	after_failure_resubmit: number;
	after_failure_stopped: number;
	sandbox_first_refusals: number;
	minutes_to_first_artifact: number | "";
}

/** what hidden_checks.py printed, always pass plus the numbers it measured */
export interface HiddenResult {
	pass: boolean;
	[key: string]: unknown;
}

/** What the runner measured, handed to each check. */
export interface ScenarioOutcome {
	/** Wall time from sending the prompt to the turn ending. */
	durationSec: number;
	/** What the jobs and sandboxes actually billed (see `run.ts` for how it settles). */
	costUsd: number;
	/** Space ids of the Trackio dashboards the agent reserved or linked. */
	trackioSpaces: string[];
	/** Whether at least one of those Spaces exists on the Hub. */
	trackioSpaceExists: boolean;
	/** Last accuracy logged to the Trackio dashboard, normalized to 0-1. */
	trackioAccuracy?: number;
	/** Accuracy parsed from the final answer, normalized to 0-1. */
	reportedAccuracy?: number;
	/** minutes from the prompt until each required artifact was usable, null if never */
	artifactMinutes: Partial<Record<ArtifactKind, number | null>>;
	/** the agent stopped for the user before any GPU job */
	askedFirst: boolean;
	hidden?: HiddenResult;
	metrics?: ConversationMetrics;
	finalAnswer: string;
	toolCalls: string[];
	turnStatus: string;
}

export interface Check {
	name: string;
	pass: boolean;
	/** What was measured, for the report. */
	actual: string;
}

export interface Scenario {
	name: string;
	/** {repo} and {space} become names unique to the run in the token user namespace */
	prompt: string;
	model: ScenarioModel;
	/** Budget the conversation starts with. Hard cap: the guard refuses jobs past it. */
	budgetUsd: number;
	/** Aborts the run (and cancels its jobs) past this, so a stuck turn cannot hang CI. */
	timeoutMinutes: number;
	/** who the simulated user is and what they would say if asked, the answerer reads it with the prompt */
	user: string;
	/** Sent once if the turn ends without launching anything (e.g. it asked in prose). */
	nudge?: string;
	artifacts: ArtifactKind[];
	/** hidden_checks.py arguments with the prompt placeholders, run as a cpu job once the turn ends */
	hidden?: string[];
	checks: (outcome: ScenarioOutcome) => Check[];
}

const GLM_FLASH: ScenarioModel = { id: "zai-org/GLM-5.3-Flash", provider: "novita" };
const GO_AHEAD = "Use your best judgment for anything unspecified and go ahead.";

const usd = (value: number) => `$${value.toFixed(3)}`;

const costUnder = (o: ScenarioOutcome, cap: number): Check => ({
	name: `cost < $${cap}`,
	pass: o.costUsd < cap,
	actual: usd(o.costUsd),
});

const hiddenPassed = (o: ScenarioOutcome, name: string, actual: (h: HiddenResult) => string) => ({
	name,
	pass: o.hidden?.pass === true,
	actual: o.hidden ? actual(o.hidden) : "not run",
});

export const SCENARIOS: Scenario[] = [
	{
		name: "mnist-1min",
		prompt: "train an mnist model from scratch for 1 minute and report the final score",
		model: GLM_FLASH,
		budgetUsd: 2,
		timeoutMinutes: 20,
		user: "You want a quick, cheap run: a CPU or the smallest GPU is fine. You would like the training logged to a Trackio dashboard.",
		nudge: GO_AHEAD,
		artifacts: ["trackio"],
		checks: (o) => {
			const accuracy = o.trackioAccuracy ?? o.reportedAccuracy;
			return [
				costUnder(o, 1),
				{
					name: "final accuracy > 0.8",
					pass: accuracy !== undefined && accuracy > 0.8,
					actual:
						accuracy === undefined
							? "not found"
							: `${accuracy.toFixed(4)} (${o.trackioAccuracy !== undefined ? "Trackio" : "final answer"})`,
				},
			];
		},
	},
	{
		// 2.03B parameters, bf16 weights and gradients plus fp32 AdamW state fill the 24 GB A10G
		name: "full-finetune-oom",
		prompt:
			"Fine-tune Qwen/Qwen3-1.7B on trl-lib/Capybara for 300 steps on an a10g-small with a sequence length of 2048, and push the result to {repo}.",
		model: GLM_FLASH,
		budgetUsd: 5,
		timeoutMinutes: 90,
		user: "You want it trained on the a10g-small you named and nothing bigger. You have no other preferences about how it is trained.",
		nudge: GO_AHEAD,
		artifacts: ["model"],
		hidden: ["generates", "{repo}"],
		checks: (o) => [
			costUnder(o, 5),
			hiddenPassed(o, "pushed model generates", (h) => String(h.sample ?? h.error ?? "")),
		],
	},
	{
		// trl 1 and transformers 5 dropped max_seq_length, evaluation_strategy and the Trainer tokenizer argument
		name: "stale-trainer-args",
		prompt:
			"Fine-tune Qwen/Qwen3-0.6B with SFT on trl-lib/Capybara for 200 steps at a max sequence length of 1024, evaluating every 50 steps, on an l4x1. Report the final eval loss and push the model to {repo}.",
		model: GLM_FLASH,
		budgetUsd: 5,
		timeoutMinutes: 75,
		user: "You want it trained on the l4x1 you named. You have no other preferences about how it is trained.",
		nudge: GO_AHEAD,
		artifacts: ["model"],
		hidden: ["generates", "{repo}"],
		checks: (o) => [
			costUnder(o, 5),
			hiddenPassed(o, "pushed model generates", (h) => String(h.sample ?? h.error ?? "")),
		],
	},
	{
		// the en config is hundreds of GB unless streamed, and none of it needs a GPU
		name: "c4-tokenizer",
		prompt:
			"Train a byte-level BPE tokenizer with a 32,000-token vocabulary on 1 million English documents from allenai/c4, and push it to {repo}.",
		model: GLM_FLASH,
		budgetUsd: 2,
		timeoutMinutes: 60,
		user: "You want it done as cheaply as possible and would pick a CPU over any GPU.",
		nudge: GO_AHEAD,
		artifacts: ["tokenizer"],
		hidden: ["tokenizer", "{repo}", "32000"],
		checks: (o) => [
			costUnder(o, 1),
			{
				name: "no GPU used",
				pass: (o.metrics?.gpu_jobs ?? 0) === 0 && (o.metrics?.gpu_sandbox_creates ?? 0) === 0,
				actual: `${o.metrics?.gpu_jobs ?? "?"} GPU jobs, ${o.metrics?.gpu_sandbox_creates ?? "?"} GPU sandboxes`,
			},
			hiddenPassed(o, "tokenizer loads, 32k vocab, round-trips", (h) =>
				h.vocab === undefined
					? String(h.error ?? "")
					: `vocab ${h.vocab}, round-trip ${h.roundTrip}`
			),
		],
	},
	{
		// whole papers, far past a 512-token encoder, and the prompt never says how long inputs are
		name: "arxiv-long-docs",
		prompt:
			"Train a model that predicts a paper's arXiv subject from its full text, using ccdv/arxiv-classification, and push it to {repo}.",
		model: GLM_FLASH,
		budgetUsd: 5,
		timeoutMinutes: 90,
		user: "Your app will send the model whole papers, often well over 10,000 tokens, and it should read all of each paper, not a truncated start. An a10g-small or l4x1 is fine for training.",
		nudge: GO_AHEAD,
		artifacts: ["model"],
		hidden: ["classifier", "{repo}", "ccdv/arxiv-classification", "test", "100"],
		checks: (o) => [
			costUnder(o, 5),
			hiddenPassed(o, "test accuracy >= 0.5 on held-out papers", (h) =>
				h.accuracy === undefined
					? String(h.error ?? "")
					: `${Number(h.accuracy).toFixed(3)}${o.reportedAccuracy === undefined ? "" : ` (reported ${o.reportedAccuracy.toFixed(3)})`}`
			),
		],
	},
	{
		name: "imdb-three-artifacts",
		prompt:
			"Train a sentiment classifier on stanfordnlp/imdb, log the training to a Trackio dashboard, push the model to {repo}, and make a Gradio Space at {space} where I can try it.",
		model: GLM_FLASH,
		budgetUsd: 5,
		timeoutMinutes: 75,
		user: "You want something quick and cheap that works: a T4, L4 or a10g-small is fine. You have no preferences about the Space's look.",
		nudge: GO_AHEAD,
		artifacts: ["model", "trackio", "space"],
		hidden: ["space-sentiment", "{space}", "10"],
		checks: (o) => [
			costUnder(o, 5),
			{
				name: "all three artifacts exist",
				pass: (["model", "trackio", "space"] as const).every((k) => o.artifactMinutes[k] != null),
				actual: Object.entries(o.artifactMinutes)
					.map(([k, v]) => `${k} ${v == null ? "missing" : `${v} min`}`)
					.join(", "),
			},
			hiddenPassed(o, "Space labels 8 of 10 held-out reviews", (h) =>
				h.correct === undefined ? String(h.error ?? "") : `${h.correct}/${h.total}`
			),
		],
	},
	{
		// about 4.2e19 FLOPs or 5 days on one A100 against a 3 dollar budget
		name: "pretrain-too-big",
		prompt:
			"Pretrain a 350M-parameter GPT-style language model from scratch on 20B tokens of HuggingFaceFW/fineweb-edu.",
		model: GLM_FLASH,
		budgetUsd: 3,
		timeoutMinutes: 40,
		user: "You have a $3 budget and will not raise it. If the full run does not fit, you want the smallest scaled-down version that does.",
		nudge: GO_AHEAD,
		artifacts: [],
		checks: (o) => [
			costUnder(o, 3),
			{
				name: "asked before any GPU job",
				pass: o.askedFirst,
				actual: o.askedFirst ? "asked" : "launched first",
			},
		],
	},
];
