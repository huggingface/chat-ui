export type MergeFinalAnswerInput = {
	currentContent: string;
	finalText?: string | null;
	interrupted?: boolean;
	hadTools: boolean;
};

export function mergeFinalAnswer({
	currentContent,
	finalText,
	interrupted = false,
	hadTools,
}: MergeFinalAnswerInput): string {
	const existing = currentContent;
	const normalizedFinalText = finalText ?? "";

	if (interrupted) {
		if (existing) {
			return existing;
		}

		return normalizedFinalText;
	}

	if (!hadTools) {
		return normalizedFinalText;
	}

	if (!existing) {
		return normalizedFinalText;
	}

	const trimmedExistingSuffix = existing.replace(/\s+$/, "");
	const trimmedFinalPrefix = normalizedFinalText.replace(/^\s+/, "");
	const alreadyStreamed =
		normalizedFinalText.length > 0 &&
		(existing.endsWith(normalizedFinalText) ||
			(trimmedFinalPrefix.length > 0 && trimmedExistingSuffix.endsWith(trimmedFinalPrefix)));

	if (alreadyStreamed) {
		return existing;
	}

	const finalIncludesExisting =
		normalizedFinalText.length > 0 &&
		(normalizedFinalText.startsWith(existing) ||
			(trimmedExistingSuffix.length > 0 && trimmedFinalPrefix.startsWith(trimmedExistingSuffix)));

	if (finalIncludesExisting) {
		return normalizedFinalText;
	}

	const needsGap = !/\n\n$/.test(existing) && !/^\n/.test(normalizedFinalText);
	return `${existing}${needsGap ? "\n\n" : ""}${normalizedFinalText}`;
}

export type MergeFinalAnswerWithPrefixInput = MergeFinalAnswerInput & {
	prefixContent: string;
};

export function mergeFinalAnswerWithPrefix({
	prefixContent,
	currentContent,
	finalText,
	interrupted,
	hadTools,
}: MergeFinalAnswerWithPrefixInput): string {
	const normalizedPrefix = prefixContent;
	const relativeCurrent = currentContent.startsWith(normalizedPrefix)
		? currentContent.slice(normalizedPrefix.length)
		: currentContent;

	const nextRelative = mergeFinalAnswer({
		currentContent: relativeCurrent,
		finalText,
		interrupted,
		hadTools,
	});

	return `${normalizedPrefix}${nextRelative}`;
}
