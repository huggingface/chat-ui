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
 * Compute an assistant message's content when a FinalAnswer arrives, mirroring the
 * server so every view agrees on the final text. Pulled out of the streaming loop
 * because the branching here — reconciling streamed content with the provider's
 * final text across the interrupted, tool-using, and plain cases — is where subtle
 * content bugs live, and it is far easier to pin down in isolation than inside the
 * component. Both the streaming path and the reattach path route through this.
 */
export function mergeFinalAnswerContent({
	existing,
	finalText,
	hadTools,
	isInterrupted,
}: MergeFinalAnswerParams): string {
	if (isInterrupted) {
		// Nothing streamed: fall back to the final text.
		if (!existing) return finalText;
		// The server may have clamped the persisted text back to a reported stop point.
		// Adopt it only when it is a prefix of what we streamed, so this view matches
		// what every other view will load; otherwise keep our streamed content (continue
		// flows receive only the post-prefix text).
		if (finalText && existing.startsWith(finalText)) return finalText;
		return existing;
	}

	if (hadTools) {
		// Providers often stream content, run tools, then return a different follow-up
		// message. Preserve the pre-tool stream instead of letting the final text clobber it.
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
