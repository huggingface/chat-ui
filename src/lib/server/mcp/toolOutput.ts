/** Composes what the *model* sees for one tool result. The UI gets the raw blocks. */

type ContentBlock = Record<string, unknown> & { type?: unknown };

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Key order is not stable across serializers, so compare canonically. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (isPlainObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/**
 * Servers are told to serialise structuredContent into a text block as well, so without
 * this the common case sends a payload that can be large twice.
 */
function textAlreadyCarries(text: string, structured: unknown): boolean {
	const trimmed = text.trim();
	if (trimmed.length === 0) return false;
	try {
		return canonical(JSON.parse(trimmed)) === canonical(structured);
	} catch {
		return false;
	}
}

function describeBlock(block: ContentBlock): string | undefined {
	const type = asString(block.type);

	if (type === "image" || type === "audio") {
		return `[${type}: ${asString(block.mimeType) ?? "unknown type"}]`;
	}

	if (type === "resource_link") {
		const label = asString(block.name) ?? asString(block.uri) ?? "unknown";
		const mime = asString(block.mimeType);
		return `[resource: ${label}${mime ? ` (${mime})` : ""}]`;
	}

	if (type === "resource") {
		const resource = isPlainObject(block.resource) ? block.resource : undefined;
		// Usually the document itself, so inline it rather than summarising it away.
		const embedded = asString(resource?.text);
		if (embedded) return embedded;

		const label = asString(resource?.uri) ?? "unknown";
		const mime = asString(resource?.mimeType);
		return `[resource: ${label}${mime ? ` (${mime})` : ""}]`;
	}

	return undefined;
}

export function buildModelToolOutput({
	text,
	structured,
	content,
}: {
	text: string;
	structured?: unknown;
	content?: unknown[];
}): string {
	const sections: string[] = [];
	if (text.length > 0) sections.push(text);

	for (const block of content ?? []) {
		if (!isPlainObject(block) || block.type === "text") continue;
		const described = describeBlock(block);
		if (described) sections.push(described);
	}

	if (structured !== undefined && !textAlreadyCarries(text, structured)) {
		sections.push(JSON.stringify(structured));
	}

	return sections.join("\n");
}
