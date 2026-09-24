/**
 * ML Intern eval scenarios. Each one is a prompt run end to end against the real
 * app, a real model and real HF Jobs, then graded on what actually happened.
 *
 * Keep scenarios cheap and short: every PR runs all of them.
 */

export interface ScenarioModel {
	/** Router model id. */
	id: string;
	/** Inference provider, pinned so a run does not drift between providers. */
	provider: string;
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
	prompt: string;
	model: ScenarioModel;
	/** Budget the conversation starts with. Hard cap: the guard refuses jobs past it. */
	budgetUsd: number;
	/** Aborts the run (and cancels its jobs) past this, so a stuck turn cannot hang CI. */
	timeoutMinutes: number;
	/**
	 * How ask_user_question gets answered. The first rule whose pattern matches the
	 * question (header, text, or option labels) picks the first option matching its
	 * `choose` pattern. With no rule matching, the runner picks the option marked
	 * recommended, else the first one. Options that change the budget are never picked.
	 */
	answers?: Array<{ question: RegExp; choose: RegExp }>;
	/** Sent once if the turn ends without launching anything (e.g. it asked in prose). */
	nudge?: string;
	checks: (outcome: ScenarioOutcome) => Check[];
}

const GLM_FLASH: ScenarioModel = { id: "zai-org/GLM-5.3-Flash", provider: "together" };

export const SCENARIOS: Scenario[] = [
	{
		name: "mnist-1min",
		prompt: "train an mnist model from scratch for 1 minute and report the final score",
		model: GLM_FLASH,
		budgetUsd: 2,
		timeoutMinutes: 15,
		answers: [
			{ question: /hardware|gpu|cpu|flavor|instance/i, choose: /cpu|t4|small|cheap/i },
			{ question: /dashboard|track|log/i, choose: /trackio|yes/i },
		],
		nudge: "Use your best judgment for anything unspecified and go ahead.",
		checks: (o) => {
			const accuracy = o.trackioAccuracy ?? o.reportedAccuracy;
			return [
				{ name: "cost < $1", pass: o.costUsd < 1, actual: `$${o.costUsd.toFixed(3)}` },
				{
					name: "time < 5 min",
					pass: o.durationSec < 300,
					actual: `${(o.durationSec / 60).toFixed(1)} min`,
				},
				{
					name: "Trackio dashboard created",
					pass: o.trackioSpaceExists,
					actual: o.trackioSpaces.join(", ") || "none",
				},
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
];
