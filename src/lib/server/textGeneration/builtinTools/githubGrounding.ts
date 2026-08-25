import {
	GITHUB_FIND_EXAMPLES,
	GITHUB_READ_FILE,
	githubTools,
	runGithubTool,
} from "$lib/server/github";
import type { BuiltinTool } from "./types";

/**
 * The GitHub code-grounding tools as builtins: read-only, stateless, nothing to
 * approve, and no MCP server to reach for.
 *
 * The doctrine below is the part that does the work. Tool descriptions alone
 * cannot carry it, because the preprompt's blanket "do not call a tool unless
 * the request needs a capability you lack" names writing code as a case to
 * answer directly — which is exactly the case grounding exists for. Hence the
 * restraint exemption on the two tools that matter; `exemptFromToolRestraint`
 * puts them on that same sentence.
 */
const GROUNDING_DOCTRINE =
	`CODE GROUNDING: Your knowledge of the Hugging Face libraries — transformers, trl, peft, accelerate, diffusers — is out of date, and you cannot tell which parts. ` +
	`Those APIs change faster than your training data: trainer classes get renamed, config arguments are removed, argument names move between releases. ` +
	`Code you write from memory will look correct and fail at import time, and you will not notice until it runs. ` +
	`So before writing ML training, fine-tuning, evaluation or inference code, call ${GITHUB_FIND_EXAMPLES} to locate a current example script and ${GITHUB_READ_FILE} to read it, ` +
	`then implement from what the file actually shows — its imports, its trainer and config arguments, its dataset handling — rather than from what you remember. ` +
	`Do this even when you feel certain; certainty about a stale API is exactly the failure. ` +
	`Skip it only for tasks that produce no code: data queries, status checks, discussion. ` +
	`Before submitting anything that costs money or time to run — a training job, a long evaluation — check that you have read a working reference implementation, and say which file it was. ` +
	`If you could not find one, say so plainly instead of proceeding on recall.`;

/**
 * Empty without a `GITHUB_TOKEN`, since `githubTools()` withholds the
 * definitions: a tool that is offered and always fails costs the model a turn
 * to discover that.
 */
export function githubGroundingBuiltins(): BuiltinTool[] {
	return githubTools().map((definition) => {
		const name = definition.function.name;
		return {
			name,
			definition,
			// Discovery is an ordinary lookup; only the two that precede writing code
			// need to escape the restraint.
			exemptFromToolRestraint: name === GITHUB_FIND_EXAMPLES || name === GITHUB_READ_FILE,
			// Stated once, on the tool the chain starts at, rather than three times.
			...(name === GITHUB_FIND_EXAMPLES ? { preprompt: GROUNDING_DOCTRINE } : {}),
			async execute(args, ctx) {
				const result = await runGithubTool(name, args, { signal: ctx.abortSignal });
				return result.isError ? { error: result.text } : { resultText: result.text };
			},
		};
	});
}
