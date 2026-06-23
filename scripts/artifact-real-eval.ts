/**
 * Real-model artifact-edit eval harness.
 *
 * Reproduces the EXACT HuggingChat path: inject ARTIFACTS_SYSTEM_PROMPT, ask the
 * real router model to create an artifact, then to edit it, assemble the assistant
 * messages the way chat-ui does (reasoning wrapped in <think>, then content), and
 * run the captured transcript through the real client parser (collectArtifacts).
 *
 * Run: SCENARIO=color MODEL=zai-org/GLM-5.2 RUN=1 npx vite-node scripts/artifact-real-eval.ts
 * Prints one JSON result line to stdout and writes the raw transcript to eval-output/.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { collectArtifacts, splitArtifactSegments } from "../src/lib/utils/artifacts";
import { ARTIFACTS_SYSTEM_PROMPT } from "../src/lib/server/textGeneration/artifacts";

const SCENARIOS: Record<string, { create: string; edit: string; expect: RegExp }> = {
	color: {
		create: "make a green button",
		edit: "make it red instead",
		// Common red hexes/keywords the models actually pick (avoid matching greens).
		expect:
			/ef4444|dc2626|f87171|ff6b6b|e83939|b91c1c|c0392b|e74c3c|db2828|\bred\b|crimson|firebrick/i,
	},
	label: {
		create: "make a button that says Click Me",
		edit: "change the button label to Submit",
		expect: />\s*Submit\s*</i,
	},
	multi: {
		create: "make a blue button labelled Go",
		edit: "change the color to orange and the label to Stop",
		expect: /Stop/i,
	},
	add: {
		create: "make a simple centered landing page with one big heading",
		edit: "add a short subtitle paragraph under the heading",
		expect: /<p|subtitle/i,
	},
	react: {
		create: "make a React counter component with an increment button",
		edit: "make the increment button add 2 instead of 1",
		expect: /\+\s*2|\+=\s*2|\bcount\s*\+\s*2/i,
	},
};

function loadEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const line of readFileSync(".env.local", "utf8").split("\n")) {
		const i = line.indexOf("=");
		if (i < 0 || line.trim().startsWith("#")) continue;
		env[line.slice(0, i).trim()] = line
			.slice(i + 1)
			.trim()
			.replace(/^"|"$/g, "");
	}
	return env;
}

async function complete(
	base: string,
	key: string,
	model: string,
	messages: Array<{ role: string; content: string }>
): Promise<string> {
	const res = await fetch(`${base}/chat/completions`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
		body: JSON.stringify({ model, messages, max_tokens: 12000, temperature: 0.6 }),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
	const j = (await res.json()) as {
		choices?: Array<{
			message?: { content?: string; reasoning?: string; reasoning_content?: string };
		}>;
	};
	const msg = j.choices?.[0]?.message ?? {};
	const reasoning = msg.reasoning ?? msg.reasoning_content ?? "";
	const content = typeof msg.content === "string" ? msg.content : "";
	// Assemble exactly like chat-ui's OpenAI path: reasoning becomes a <think> block
	// before the visible content. This is what collectArtifacts() actually receives.
	return reasoning ? `<think>${reasoning}</think>${content}` : content;
}

async function main() {
	const scenarioId = process.env.SCENARIO ?? "color";
	const model = process.env.MODEL ?? "zai-org/GLM-5.2";
	const run = process.env.RUN ?? "1";
	const scenario = SCENARIOS[scenarioId];
	if (!scenario) throw new Error(`unknown scenario ${scenarioId}`);

	const env = loadEnv();
	const base = env.OPENAI_BASE_URL;
	const key = env.OPENAI_API_KEY;
	const sys = { role: "system", content: ARTIFACTS_SYSTEM_PROMPT };

	const createOut = await complete(base, key, model, [
		sys,
		{ role: "user", content: scenario.create },
	]);
	const editOut = await complete(base, key, model, [
		sys,
		{ role: "user", content: scenario.create },
		{ role: "assistant", content: createOut },
		{ role: "user", content: scenario.edit },
	]);

	const msgs = [
		{ id: "u1", from: "user" as const, content: scenario.create },
		{ id: "a1", from: "assistant" as const, content: createOut },
		{ id: "u2", from: "user" as const, content: scenario.edit },
		{ id: "a2", from: "assistant" as const, content: editOut },
	];
	const registry = collectArtifacts(msgs);

	// How many update pairs the parser extracted from the edit turn (think stripped, as collectArtifacts does)
	const editVisible = editOut.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "");
	let parsedUpdatePairs = 0;
	let editOpKind = "none";
	for (const seg of splitArtifactSegments(editVisible)) {
		if (seg.type === "artifact") {
			editOpKind = seg.op.kind;
			if (seg.op.kind === "update") parsedUpdatePairs += seg.op.pairs.length;
		}
	}

	const artifactsArr = [...registry.artifacts.values()];
	const deadCard = [...registry.byMessageOp.values()].some((r) => r.version === -1);
	const primary = artifactsArr[0];
	const versions = primary?.versions ?? [];
	const last = versions.at(-1);
	const v1 = versions[0];
	const contentChanged = !!last && !!v1 && last.content !== v1.content;
	const editReflected = !!last && scenario.expect.test(last.content);

	const result = {
		scenario: scenarioId,
		model,
		run,
		artifactCount: artifactsArr.length,
		versions: versions.length,
		lastOp: last?.op ?? "none",
		editOpKind, // what the model emitted on the edit turn: create/update/none
		parsedUpdatePairs,
		failedPairs: last?.failedPairs ?? 0,
		deadCard,
		contentChanged,
		editReflected,
		// success = the edit produced a correct new version of the same artifact
		ok:
			artifactsArr.length === 1 &&
			versions.length >= 2 &&
			contentChanged &&
			editReflected &&
			!last?.failedPairs,
	};

	mkdirSync("eval-output", { recursive: true });
	const safeModel = model.replace(/\//g, "_");
	writeFileSync(
		`eval-output/${scenarioId}-${safeModel}-${run}.txt`,
		`SCENARIO ${scenarioId} | MODEL ${model} | RUN ${run}\n\n===== CREATE OUTPUT =====\n${createOut}\n\n===== EDIT OUTPUT =====\n${editOut}\n\n===== RESULT =====\n${JSON.stringify(result, null, 2)}\n`
	);
	console.log(JSON.stringify(result));
}

main().catch((e) => {
	console.log(JSON.stringify({ error: String(e?.message ?? e) }));
	process.exit(1);
});
