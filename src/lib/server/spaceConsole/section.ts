import type { ObjectId } from "mongodb";
import type { SpaceConsoleEntry } from "$lib/types/SpaceConsole";
import { readConsoleEntries, readFrame } from "./store";

export interface ConsoleWaits {
	/** for the tab to get the update, open the pane and report it */
	attachMs: number;
	/** for the frame to answer this check, the pane gives a fresh load 5 s */
	answerMs: number;
	pollMs: number;
}

export const CONSOLE_WAITS: ConsoleWaits = { attachMs: 4000, answerMs: 6500, pollMs: 250 };

const SHOW_HEAD = 10;
const SHOW_TAIL = 30;
const TEXT_MAX = 600;
const STACK_LINES = 4;

const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true }
		);
	});

/** waits for the tab to ask the space for its console on this check, then reads the reply, never throws */
export async function consoleSection(params: {
	conversationId: ObjectId;
	spaceId: string;
	checkId: string;
	signal?: AbortSignal;
	waits?: ConsoleWaits;
}): Promise<string[]> {
	const { conversationId, spaceId, checkId, signal, waits = CONSOLE_WAITS } = params;
	try {
		const until = async (deadlineMs: number, done: () => Promise<boolean>) => {
			const end = Date.now() + deadlineMs;
			for (;;) {
				if (await done()) return true;
				if (Date.now() >= end || signal?.aborted) return false;
				await sleep(waits.pollMs, signal);
			}
		};

		let frame = await readFrame(conversationId, spaceId);
		const attached = await until(waits.attachMs, async () => {
			frame = await readFrame(conversationId, spaceId);
			return frame?.checkId === checkId;
		});
		if (!attached) {
			return ["Console: no browser tab has this Space open, so its browser console can't be read."];
		}
		await until(waits.answerMs, async () => {
			frame = await readFrame(conversationId, spaceId);
			if (!frame || frame.checkId !== checkId || frame.answeredCheck === checkId) return true;
			// a load opened for this check already sent its gets and gave up
			return frame.loadedFor === checkId && frame.state === "unsupported";
		});
		if (frame?.answeredCheck === checkId) {
			const entries = await readConsoleEntries(conversationId, spaceId);
			return formatConsole(entries, frame.sessionId, frame.gradioVersion, frame.dropped);
		}
		if (frame?.checkId !== checkId) {
			return [
				"Console: the browser tab moved on to another check; check the Space again to read it.",
			];
		}
		if (frame.state === "loading") {
			return ["Console: the Space is still loading in the browser tab; check it again to read it."];
		}
		if (frame.state === "unsupported") {
			return [
				"Console: the Space shows in the browser tab, but its frontend does not answer for its " +
					"console (a Gradio version without console forwarding, or a custom frontend).",
			];
		}
		return ["Console: the Space did not answer in time; check it again to read it."];
	} catch (err) {
		return [`Console: could not be read (${String(err)}).`];
	}
}

function formatEntry(entry: SpaceConsoleEntry): string[] {
	const text = entry.text.length > TEXT_MAX ? `${entry.text.slice(0, TEXT_MAX)}…` : entry.text;
	const lines = [`  [${entry.level}] ${text.replace(/\n/g, "\n    ")}`];
	if (entry.stack) {
		const stack = entry.stack.split("\n").filter((line) => line.trim());
		// an error stack usually repeats its message on the first line
		const frames = stack[0]?.includes(entry.text.split("\n")[0]) ? stack.slice(1) : stack;
		lines.push(...frames.slice(0, STACK_LINES).map((line) => `    ${line.trim()}`));
	}
	return lines;
}

export function formatConsole(
	entries: SpaceConsoleEntry[],
	currentSession: string | undefined,
	gradioVersion: string | undefined,
	dropped = 0
): string[] {
	const out = formatEntries(entries, currentSession, gradioVersion);
	if (dropped > 0) {
		out.push(
			`The page dropped ${dropped} older ${dropped === 1 ? "entry" : "entries"}: it keeps the last 100.`
		);
	}
	return out;
}

function formatEntries(
	entries: SpaceConsoleEntry[],
	currentSession: string | undefined,
	gradioVersion: string | undefined
): string[] {
	const version = gradioVersion ? `, Gradio ${gradioVersion}` : "";
	if (!entries.length) {
		return [`Console (browser tab${version}): nothing logged since the page loaded.`];
	}
	const sessions = [...new Set(entries.map((entry) => entry.sessionId))];
	const labelled = sessions.length > 1 || sessions[0] !== currentSession;
	const out = [
		`Console (browser tab${version}): ${entries.length} ${entries.length === 1 ? "entry" : "entries"}, oldest first` +
			(sessions.length > 1 ? `, from ${sessions.length} page loads` : "") +
			":",
	];
	const shown =
		entries.length > SHOW_HEAD + SHOW_TAIL
			? [...entries.slice(0, SHOW_HEAD), null, ...entries.slice(-SHOW_TAIL)]
			: entries;
	let session: string | undefined;
	for (const entry of shown) {
		if (!entry) {
			out.push(`  …[${entries.length - SHOW_HEAD - SHOW_TAIL} entries omitted]…`);
			session = undefined;
			continue;
		}
		if (labelled && entry.sessionId !== session) {
			session = entry.sessionId;
			const n = sessions.indexOf(session) + 1;
			out.push(`page load ${n}${session === currentSession ? " (the page open now)" : ""}:`);
		}
		out.push(...formatEntry(entry));
	}
	if (currentSession && !sessions.includes(currentSession)) {
		out.push("The page open now has logged nothing.");
	}
	return out;
}
