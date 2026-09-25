import type { ExpectedPush } from "$lib/types/MlService";

// string literals only, a name assigned one literal once counts, an id built at runtime is left
// to the namespace listing when the job ends

const MAX_EXPECTED_PUSHES = 10;
const MAX_CALL_ARGS_CHARS = 4_000;
const REPO_ID = /^[A-Za-z0-9][\w.-]{0,95}\/[A-Za-z0-9][\w.-]{0,95}$/;
/** the dashboard and its storage belong to trackio, not to the run */
const TRACKIO = /trackio/i;

// a letter before the quote marks an f, r or b string, named groups since it is spliced into
// patterns with groups of their own
const LITERAL = String.raw`(?<!\w)(?<quote>["'])(?<value>[^"'\\\n]*)\k<quote>`;
/** a bare name, not an attribute, a call, a subscript or a string prefix */
const IDENTIFIER = String.raw`(?<name>[A-Za-z_]\w*)(?![\w"'.(\[])`;

const HUB_MODEL_ID = new RegExp(
	String.raw`\bhub_model_id["']?\s*[:=](?!=)\s*(?:${LITERAL}|${IDENTIFIER})`,
	"g"
);
const HUB_MODEL_ID_FLAG =
	/--hub[_-]model[_-]id(?:=|\s+)["']?([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)/g;
const PUSH_CALL =
	/(?:([A-Za-z_][\w.]*)\s*\.\s*)?\b(push_to_hub|upload_folder|upload_file|upload_large_folder|create_repo)\s*\(/g;
const CONSTANT = new RegExp(
	String.raw`^[ \t]*(?<constant>[A-Za-z_]\w*)[ \t]*(?::[^=\n]*)?=[ \t]*${LITERAL}[ \t]*(?:#.*)?$`,
	"gm"
);
const ASSIGNMENT = /^[ \t]*([A-Za-z_]\w*)[ \t]*(?::[^=\n]*)?=(?!=)/gm;

type Candidate = { id: string; kind: ExpectedPush["kind"]; guessed: boolean };

/** names assigned exactly once, and that once to a plain string */
function literalConstants(source: string): Map<string, string> {
	const assignments = new Map<string, number>();
	for (const [, name] of source.matchAll(ASSIGNMENT)) {
		assignments.set(name, (assignments.get(name) ?? 0) + 1);
	}
	const constants = new Map<string, string>();
	for (const { groups } of source.matchAll(CONSTANT)) {
		if (groups && assignments.get(groups.constant) === 1) {
			constants.set(groups.constant, groups.value);
		}
	}
	return constants;
}

/** the text inside a call, quotes respected, cut short on a runaway */
function callArguments(source: string, open: number): string {
	let depth = 0;
	let quote: string | undefined;
	const end = Math.min(source.length, open + MAX_CALL_ARGS_CHARS);
	for (let i = open; i < end; i++) {
		const char = source[i];
		if (quote) {
			if (char === "\\") i++;
			else if (char === quote) quote = undefined;
			continue;
		}
		if (char === '"' || char === "'") quote = char;
		else if (char === "(" || char === "[" || char === "{") depth++;
		else if (char === ")" || char === "]" || char === "}") {
			depth--;
			if (depth === 0) return source.slice(open + 1, i);
		}
	}
	return source.slice(open + 1, end);
}

function splitArguments(args: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let quote: string | undefined;
	let start = 0;
	for (let i = 0; i < args.length; i++) {
		const char = args[i];
		if (quote) {
			if (char === "\\") i++;
			else if (char === quote) quote = undefined;
			continue;
		}
		if (char === '"' || char === "'") quote = char;
		else if (char === "(" || char === "[" || char === "{") depth++;
		else if (char === ")" || char === "]" || char === "}") depth--;
		else if (char === "," && depth === 0) {
			parts.push(args.slice(start, i).trim());
			start = i + 1;
		}
	}
	parts.push(args.slice(start).trim());
	return parts.filter(Boolean);
}

function resolve(expression: string, constants: Map<string, string>): string | undefined {
	const literal = /^(["'])([^"'\\\n]*)\1$/.exec(expression);
	if (literal) return literal[2];
	if (/^[A-Za-z_]\w*$/.test(expression)) return constants.get(expression);
	return undefined;
}

// push_to_hub is shared by models and datasets, so its kind is a guess the end check retries
const looksLikeDataset = (receiver: string | undefined): boolean => {
	const last = receiver?.split(".").pop() ?? "";
	return /(?:^|_)ds(?:$|_)|data/i.test(last);
};

function fromCall(
	name: string,
	receiver: string | undefined,
	args: string,
	constants: Map<string, string>
): Candidate | undefined {
	if (receiver?.split(".")[0] === "trackio") return undefined;
	const positional: string[] = [];
	const keywords = new Map<string, string>();
	for (const arg of splitArguments(args)) {
		const keyword = /^(\w+)\s*=(?!=)\s*([\s\S]*)$/.exec(arg);
		if (keyword) keywords.set(keyword[1], keyword[2].trim());
		else positional.push(arg);
	}
	const idExpression =
		keywords.get("repo_id") ??
		(name === "push_to_hub" || name === "create_repo" ? positional[0] : undefined);
	const id = idExpression ? resolve(idExpression, constants) : undefined;
	if (!id) return undefined;
	const repoTypeExpression = keywords.get("repo_type");
	const repoType = repoTypeExpression ? resolve(repoTypeExpression, constants) : undefined;
	if (repoType === "space") return undefined;
	if (repoType === "dataset") return { id, kind: "dataset", guessed: false };
	if (repoType === "model" || name !== "push_to_hub") return { id, kind: "model", guessed: false };
	return { id, kind: looksLikeDataset(receiver) ? "dataset" : "model", guessed: true };
}

/** where the script and arguments of a job say it pushes, in order of first mention */
export function expectedPushesIn(sources: readonly string[]): ExpectedPush[] {
	const source = sources.join("\n").replace(/^[ \t]*#.*$/gm, "");
	const constants = literalConstants(source);
	const found: { index: number; candidate: Candidate }[] = [];

	for (const match of source.matchAll(HUB_MODEL_ID)) {
		const { value, name } = match.groups ?? {};
		const id = value ?? (name ? constants.get(name) : undefined);
		if (id) found.push({ index: match.index, candidate: { id, kind: "model", guessed: false } });
	}
	for (const match of source.matchAll(HUB_MODEL_ID_FLAG)) {
		found.push({ index: match.index, candidate: { id: match[1], kind: "model", guessed: false } });
	}
	for (const match of source.matchAll(PUSH_CALL)) {
		const open = match.index + match[0].length - 1;
		const candidate = fromCall(match[2], match[1], callArguments(source, open), constants);
		if (candidate) found.push({ index: match.index, candidate });
	}

	const byId = new Map<string, Candidate>();
	for (const { candidate } of found.sort((a, b) => a.index - b.index)) {
		if (!REPO_ID.test(candidate.id) || TRACKIO.test(candidate.id)) continue;
		const seen = byId.get(candidate.id);
		if (!seen || (seen.guessed && !candidate.guessed)) byId.set(candidate.id, candidate);
	}
	return [...byId.values()]
		.slice(0, MAX_EXPECTED_PUSHES)
		.map(({ id, kind }) => ({ kind, uri: `hf://${kind}s/${id}` }));
}

const stringValues = (value: unknown): string[] =>
	typeof value === "string"
		? [value]
		: Array.isArray(value)
			? value.filter((v): v is string => typeof v === "string")
			: [];

/** the script, its arguments and a docker command, as the guard sees them after expansion */
export function expectedPushesOfJob(jobArgs: Record<string, unknown>): ExpectedPush[] {
	return expectedPushesIn([
		...stringValues(jobArgs.script),
		stringValues(jobArgs.script_args).join(" "),
		stringValues(jobArgs.command).join(" "),
	]);
}
