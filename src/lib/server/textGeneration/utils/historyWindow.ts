import type { OpenAI } from "openai";
import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import { ASK_USER_QUESTION_TOOL_NAME } from "$lib/server/askUserQuestion";
import type { HistoryWindowStart } from "$lib/types/Conversation";

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** below the 3.6 measured on ml intern content, so a wrong guess sends less rather than too much */
export const CHARS_PER_TOKEN = 3;

/** reply allowance for a model that configures no limit of its own */
export const DEFAULT_OUTPUT_TOKENS = 4_096;

const SLIDE_TRIGGER = 0.75;
const SLIDE_TARGET = 0.5;

/** charged per image instead of its data url, which runs to hundreds of thousands of characters */
const IMAGE_COST_CHARS = 4_000;
const IMAGE_COST_PLACEHOLDER = "i".repeat(IMAGE_COST_CHARS);

/** bounds the marker, whose length varies with its counts */
const MARKER_COST_CHARS = 300;

export function historyCost(value: unknown): number {
	return JSON.stringify(value, (key, inner) =>
		key === "url" && typeof inner === "string" && inner.startsWith("data:")
			? IMAGE_COST_PLACEHOLDER
			: inner
	).length;
}

const messageCosts = new WeakMap<object, number>();

function messageCost(message: ChatMessageParam): number {
	const cached = messageCosts.get(message);
	if (cached !== undefined) return cached;
	const cost = historyCost(message) + 1;
	messageCosts.set(message, cost);
	return cost;
}

function unitCost(messages: ChatMessageParam[]): number {
	return messages.reduce((total, message) => total + messageCost(message), 0);
}

/**
 * one piece of history the window keeps or drops whole, a user message, a tool round
 * with its results, or a text answer
 */
export type HistoryUnit = {
	messages: ChatMessageParam[];
	/** where the window may begin, absent on units that cannot open it */
	start?: HistoryWindowStart;
	opensTurn?: boolean;
	/** the system prompt, sent whatever the window */
	head?: boolean;
	rounds: number;
	/** the ask_user_question call and its answer alone, kept when the round is outside the window */
	question?: ChatMessageParam[];
};

export function windowLimitChars(contextLengthTokens: number, maxOutputTokens?: number): number {
	const reserve = maxOutputTokens && maxOutputTokens > 0 ? maxOutputTokens : DEFAULT_OUTPUT_TOKENS;
	return Math.max(0, contextLengthTokens - reserve) * CHARS_PER_TOKEN;
}

const isToolRound = (message: ChatMessageParam | undefined) =>
	message?.role === "assistant" && (message.tool_calls?.length ?? 0) > 0;

/** splits replayed messages so a tool result never leaves the round that called it */
export function groupRounds(messages: ChatMessageParam[]): ChatMessageParam[][] {
	const groups: ChatMessageParam[][] = [];
	for (const message of messages) {
		const last = groups.at(-1);
		if (message.role === "tool" && last) {
			last.push(message);
		} else {
			groups.push([message]);
		}
	}
	return groups;
}

export function answeredQuestion(group: ChatMessageParam[]): ChatMessageParam[] | undefined {
	const [call, ...results] = group;
	if (call?.role !== "assistant" || !call.tool_calls) return undefined;
	const asks = call.tool_calls.filter((c) => c.function.name === ASK_USER_QUESTION_TOOL_NAME);
	if (asks.length === 0) return undefined;
	const ids = new Set(asks.map((c) => c.id));
	return [
		{ role: "assistant", tool_calls: asks },
		...results.filter((m) => m.role === "tool" && ids.has(m.tool_call_id)),
	];
}

/** units for what the live loop appended, retry nudges get no start and open no turn */
export function liveUnits(
	messages: ChatMessageParam[],
	liveMessageId: string | undefined,
	firstRound: number
): HistoryUnit[] {
	let round = firstRound;
	return groupRounds(messages).map((group) => {
		if (!isToolRound(group[0])) return { messages: group, rounds: 0 };
		const unit: HistoryUnit = {
			messages: group,
			rounds: 1,
			question: answeredQuestion(group),
			...(liveMessageId ? { start: { messageId: liveMessageId, round } } : {}),
		};
		round += 1;
		return unit;
	});
}

export type WindowPlan = {
	/** first unit of the window, everything before it is dropped unless pinned */
	from: number;
	start?: HistoryWindowStart;
	moved: boolean;
	chars: number;
};

type Layout = {
	brief: number;
	turnOf: number[];
	costs: number[];
	suffix: number[];
	/** question cost of the units before each index, from the first unit after the brief */
	questions: number[];
	pre: number;
};

function layout(units: HistoryUnit[]): Layout | undefined {
	const brief = units.findIndex((unit) => unit.opensTurn);
	if (brief === -1) return undefined;
	const costs = units.map((unit) => unitCost(unit.messages));
	const suffix = new Array<number>(units.length + 1).fill(0);
	for (let i = units.length - 1; i >= 0; i -= 1) suffix[i] = suffix[i + 1] + costs[i];
	const turnOf: number[] = [];
	const questions: number[] = [];
	let turn = -1;
	let questionTotal = 0;
	for (const [i, unit] of units.entries()) {
		if (unit.opensTurn) turn = i;
		turnOf.push(turn);
		questions.push(questionTotal);
		const question = unit.question;
		if (i > brief && question) questionTotal += unitCost(question);
	}
	questions.push(questionTotal);
	const pre = costs.slice(0, brief + 1).reduce((total, cost) => total + cost, 0);
	return { brief, turnOf, costs, suffix, questions, pre };
}

function charsFrom(l: Layout, from: number, fixedChars: number): number {
	if (from <= l.brief + 1) return fixedChars + l.pre + l.suffix[l.brief + 1];
	const turn = l.turnOf[from];
	const reopened = turn > l.brief && turn < from ? l.costs[turn] : 0;
	return fixedChars + l.pre + MARKER_COST_CHARS + l.questions[from] + reopened + l.suffix[from];
}

const sameStart = (a: HistoryWindowStart | undefined, b: HistoryWindowStart) =>
	a?.messageId === b.messageId && a.round === b.round;

/**
 * where the window starts for this request, the stored start holds until the request passes
 * the trigger, then moves once to the first boundary under the target
 */
export function planWindow(
	units: HistoryUnit[],
	opts: { limitChars: number; fixedChars: number; stored?: HistoryWindowStart }
): WindowPlan {
	const l = layout(units);
	if (!l) {
		const chars = opts.fixedChars + unitCost(units.flatMap((unit) => unit.messages));
		return { from: 0, moved: false, chars };
	}
	const base = l.brief + 1;
	const stored = opts.stored;
	const storedAt = stored
		? units.findIndex((unit) => unit.start && sameStart(unit.start, stored))
		: -1;
	const current = storedAt > base ? storedAt : base;
	const startOf = (i: number) => (i > base ? units[i].start : undefined);

	const currentChars = charsFrom(l, current, opts.fixedChars);
	if (currentChars <= opts.limitChars * SLIDE_TRIGGER) {
		return { from: current, start: startOf(current), moved: false, chars: currentChars };
	}
	let target = current;
	for (let i = current + 1; i < units.length; i += 1) {
		if (!units[i].start) continue;
		target = i;
		if (charsFrom(l, i, opts.fixedChars) <= opts.limitChars * SLIDE_TARGET) break;
	}
	return {
		from: target,
		start: startOf(target),
		moved: target !== current,
		chars: charsFrom(l, target, opts.fixedChars),
	};
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function omittedMarker(turns: number, rounds: number): string {
	return (
		`[Earlier history omitted: ${plural(turns, "turn")} / ${plural(rounds, "tool round")}. ` +
		"Any plan or session state shown is current; re-read files and check job status rather " +
		"than relying on memory of the omitted part.]"
	);
}

type UserContent = Extract<ChatMessageParam, { role: "user" }>["content"];

function joinUserContent(a: UserContent, b: UserContent): UserContent {
	if (typeof a === "string" && typeof b === "string") return `${a}\n\n${b}`;
	const parts = (content: UserContent) =>
		typeof content === "string" ? [{ type: "text" as const, text: content }] : content;
	return [...parts(a), { type: "text", text: "\n\n" }, ...parts(b)];
}

/** the kept units in order, with the marker after the brief where history was dropped */
export function renderWindow(units: HistoryUnit[], plan: WindowPlan): ChatMessageParam[] {
	const brief = units.findIndex((unit) => unit.opensTurn);
	if (brief === -1 || plan.from <= brief + 1) return units.flatMap((unit) => unit.messages);

	const turn = units.slice(0, plan.from + 1).findLastIndex((unit) => unit.opensTurn);
	const reopened = turn < plan.from ? turn : -1;
	let turns = 0;
	let rounds = 0;
	const kept: ChatMessageParam[] = [];
	for (const [i, unit] of units.slice(0, plan.from).entries()) {
		if (unit.head || i < brief) {
			kept.push(...unit.messages);
		} else if (i === brief || i === reopened) {
			kept.push(...unit.messages);
		} else if (unit.question) {
			kept.push(...unit.question);
		} else {
			if (unit.opensTurn) turns += 1;
			rounds += unit.rounds;
		}
	}
	const window = units.slice(plan.from).flatMap((unit) => unit.messages);

	const briefAt = units.slice(0, brief).reduce((n, unit) => n + unit.messages.length, 0);
	const briefMessage = kept[briefAt];
	if (briefMessage?.role !== "user") return [...kept, ...window];
	const out = [...kept, ...window];
	let content = joinUserContent(briefMessage.content, omittedMarker(turns, rounds));
	const next = out[briefAt + 1];
	if (next?.role === "user") {
		// two user messages in a row are refused by chat templates that enforce alternation
		content = joinUserContent(content, next.content);
		out.splice(briefAt + 1, 1);
	}
	out[briefAt] = { ...briefMessage, content };
	return out;
}

export async function saveHistoryWindowStart(
	conversationId: ObjectId,
	start: HistoryWindowStart
): Promise<void> {
	await collections.conversations.updateOne(
		{ _id: conversationId },
		{ $set: { historyWindow: start } }
	);
}

/**
 * fits each request of a tool loop to the window, the list the loop builds keeps everything
 * and only the request is cut
 */
export function createHistoryWindow(opts: {
	conversationId: ObjectId;
	units: HistoryUnit[];
	/** messages ahead of the history in the list, a prepended system prompt */
	offset: number;
	limitChars: number;
	/** sent with every request but not in the list, the tool schemas */
	fixedChars: number;
	stored?: HistoryWindowStart;
	liveMessageId?: string;
	save?: (conversationId: ObjectId, start: HistoryWindowStart) => Promise<void>;
}) {
	const save = opts.save ?? saveHistoryWindowStart;
	const historyLength = opts.units.reduce((n, unit) => n + unit.messages.length, 0);
	const firstLiveRound = opts.liveMessageId
		? opts.units.filter((unit) => unit.rounds > 0 && unit.start?.messageId === opts.liveMessageId)
				.length
		: 0;
	let stored = opts.stored;

	return {
		async fit(list: ChatMessageParam[]): Promise<ChatMessageParam[]> {
			if (list.length < opts.offset + historyLength) {
				logger.warn(
					{ listLength: list.length, historyLength },
					"[history] request list lost history messages; sending it unwindowed"
				);
				return list;
			}
			const head = list.slice(0, opts.offset);
			let at = opts.offset;
			const history = opts.units.map((unit) => {
				const messages = list.slice(at, at + unit.messages.length);
				at += unit.messages.length;
				return { ...unit, messages };
			});
			const units = [...history, ...liveUnits(list.slice(at), opts.liveMessageId, firstLiveRound)];
			const plan = planWindow(units, {
				limitChars: opts.limitChars,
				fixedChars: opts.fixedChars + unitCost(head),
				stored,
			});
			if (plan.moved && plan.start) {
				stored = plan.start;
				const conversationId = opts.conversationId.toString();
				logger.info(
					{ conversationId, start: plan.start, chars: plan.chars, limitChars: opts.limitChars },
					"[history] window slid"
				);
				try {
					await save(opts.conversationId, plan.start);
				} catch (err) {
					logger.warn(
						{ conversationId, err: String(err) },
						"[history] could not store the window start"
					);
				}
			}
			if (plan.chars > opts.limitChars) {
				logger.warn(
					{
						conversationId: opts.conversationId.toString(),
						chars: plan.chars,
						limitChars: opts.limitChars,
					},
					"[history] request is over the window even fully slid"
				);
			}
			return [...head, ...renderWindow(units, plan)];
		},
	};
}
