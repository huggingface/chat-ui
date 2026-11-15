/** past these a cell renders as it is stored, so one huge value can not hang the pane */
const MAX_DEPTH = 6;
const MAX_PARSE_CHARS = 100_000;
const MAX_NODES = 2_000;

const looksLikeJson = (text: string) => {
	const start = text.trimStart()[0];
	return start === "{" || start === "[";
};

/** an object or array the string serializes, undefined for anything else */
export function parseJsonText(text: string): object | undefined {
	if (text.length > MAX_PARSE_CHARS || !looksLikeJson(text)) return undefined;
	try {
		const parsed: unknown = JSON.parse(text);
		return parsed !== null && typeof parsed === "object" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/**
 * strings holding serialized JSON become the value they hold, at any depth, for display only,
 * the stored value is never replaced
 */
export function unpackJson(value: unknown): unknown {
	let nodes = 0;
	const walk = (node: unknown, depth: number): unknown => {
		nodes += 1;
		if (nodes > MAX_NODES || depth > MAX_DEPTH) return node;
		if (typeof node === "string") {
			const parsed = parseJsonText(node);
			return parsed === undefined ? node : walk(parsed, depth + 1);
		}
		if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
		if (node !== null && typeof node === "object") {
			return Object.fromEntries(
				Object.entries(node).map(([key, item]) => [key, walk(item, depth + 1)])
			);
		}
		return node;
	};
	return walk(value, 0);
}

export const isContainer = (value: unknown): value is object =>
	value !== null && typeof value === "object";

const FLAT_KEYS = 8;
const FLAT_CHARS = 200;

/** a few short scalar entries, shown as a key and value list rather than a tree */
export function isFlatObject(value: unknown): value is Record<string, unknown> {
	if (!isContainer(value) || Array.isArray(value)) return false;
	const entries = Object.entries(value);
	return (
		entries.length > 0 &&
		entries.length <= FLAT_KEYS &&
		entries.every(([, item]) => !isContainer(item) && String(item).length <= FLAT_CHARS)
	);
}

export function jsonSummary(value: unknown): string {
	if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
	if (isContainer(value)) {
		const keys = Object.keys(value);
		return `${keys.length} key${keys.length === 1 ? "" : "s"}: ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""}`;
	}
	return JSON.stringify(value) ?? String(value);
}
