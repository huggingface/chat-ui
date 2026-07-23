export interface MergeFinalAnswerParams {
	/** Content accumulated on the message so far (streamed tokens). */
	existing: string;
	/** The FinalAnswer's text. */
	finalText: string;
	/** Whether any tool update occurred during this turn. */
	hadTools: boolean;
	/** Whether the run was interrupted (stopped). */
	isInterrupted: boolean;
}

/**
 * Content for an assistant message when a FinalAnswer arrives, mirroring the server so
 * every view agrees. Isolated (and unit-tested) because this reconciliation of streamed
 * content with the provider's final text is where subtle content bugs live; both the
 * streaming and reattach paths route through it.
 */
export function mergeFinalAnswerContent({
	existing,
	finalText,
	hadTools,
	isInterrupted,
}: MergeFinalAnswerParams): string {
	if (isInterrupted) {
		if (!existing) return finalText;
		// The server may have clamped the persisted text back to the stop point. Adopt it
		// only when it is a prefix of ours, so this view matches what others will load;
		// otherwise keep our streamed content (continue flows send only post-prefix text).
		if (finalText && existing.startsWith(finalText)) return finalText;
		return existing;
	}

	if (hadTools) {
		// Providers often stream content, run tools, then return a different follow-up
		// message; preserve the pre-tool stream instead of letting the final text clobber it.
		const trimmedExistingSuffix = existing.replace(/\s+$/, "");
		const trimmedFinalPrefix = finalText.replace(/^\s+/, "");
		const alreadyStreamed =
			!!finalText &&
			(existing.endsWith(finalText) ||
				(trimmedFinalPrefix.length > 0 && trimmedExistingSuffix.endsWith(trimmedFinalPrefix)));

		if (existing.length > 0) {
			// A. We already streamed the same final text; keep it.
			if (alreadyStreamed) return existing;
			// B. The final text already includes the streamed prefix; use it verbatim.
			if (
				finalText &&
				(finalText.startsWith(existing) ||
					(trimmedExistingSuffix.length > 0 &&
						trimmedFinalPrefix.startsWith(trimmedExistingSuffix)))
			) {
				return finalText;
			}
			// C. Distinct pre-tool and post-tool text; join with a paragraph break.
			const needsGap = !/\n\n$/.test(existing) && !/^\n/.test(finalText);
			return existing + (needsGap ? "\n\n" : "") + finalText;
		}
		return finalText;
	}

	// No tools: the provider's final text is authoritative.
	return finalText;
}
