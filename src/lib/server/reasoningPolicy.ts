/**
 * Whether a model may be sent its own prior reasoning back — as
 * `reasoning_content` on past assistant turns, and on the assistant tool-call
 * message between rounds of a tool loop.
 *
 * Default ON, with a blocklist, rather than opt-in via a capability flag.
 *
 * Opt-in was tried first and is the wrong shape: a model that reasons but
 * nobody has flagged silently loses preservation, with no error and no signal
 * that anything is missing — so every newly added reasoning model is broken
 * until someone remembers to update the config. Defaulting on inverts that:
 * the common case works untouched and only the exceptions need maintenance.
 * Measured against the pinned harness cohort, that is 9 models needing no
 * entry versus 1 that does.
 *
 * Nothing is invented by defaulting on. Reasoning is only ever echoed when the
 * model actually produced it — an unflagged non-reasoning model has no trace
 * to replay, so it is unaffected either way. The gate matters solely for
 * models that DO emit reasoning but must not receive it back.
 */

/**
 * Families that must not receive their own reasoning back.
 *
 * `gemma` — Google documents that historical thoughts must be stripped
 * ("historical model output must only include the final response"), and the
 * router's provider enforces it rather than ignoring it:
 *
 *   HTTP 400 messages.2.assistant.reasoning_content: property
 *   'messages.2.assistant.reasoning_content' is unsupported
 *
 * Matched on the id substring so community re-releases inherit it — the same
 * chat template carries the same constraint whoever republishes it. On the
 * current router that covers google/gemma-3*, google/gemma-4*,
 * pearl-ai/Gemma-4-31B-it-pearl and aisingapore/Gemma-SEA-LION-v4-27B-IT.
 */
const BLOCKED_ID_PATTERNS: RegExp[] = [/gemma/i];

/**
 * The default for a model the config says nothing about. A `preservesReasoning`
 * entry in the MODELS overrides wins over this, so a self-hosted backend that
 * needs the opposite of the default can say so per model without a code change.
 */
export function preservesReasoningByDefault(modelId: string | undefined): boolean {
	if (!modelId) return true;
	return !BLOCKED_ID_PATTERNS.some((pattern) => pattern.test(modelId));
}
