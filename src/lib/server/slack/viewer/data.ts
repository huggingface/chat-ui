import type { Conversation } from "$lib/types/Conversation";
import { visibleText } from "../presentation";

/** Render as text only. Omit private reasoning and strip credentials/inline binary payloads. */
export function scrub(value: unknown, secrets: string[] = []): unknown {
	if (typeof value === "string") {
		let text = value.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "");
		for (const secret of secrets.filter((s) => s.length >= 8))
			text = text.split(secret).join("[redacted]");
		return text
			.replace(
				/\b(?:hf_[A-Za-z0-9]{10,}|xox[baprs]-[A-Za-z0-9-]+|xapp-[A-Za-z0-9-]+)/g,
				"[redacted]"
			)
			.replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/g, "[inline file omitted]")
			.slice(0, 24000);
	}
	if (Array.isArray(value)) return value.slice(0, 200).map((v) => scrub(v, secrets));
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.filter(
					([k]) => !["reasoning", "reasoning_content", "thinking", "base64", "data"].includes(k)
				)
				.map(([k, v]) => [
					k,
					/token|secret|password|authorization|cookie|api.?key/i.test(k)
						? "[redacted]"
						: scrub(v, secrets),
				])
		);
	return value;
}
export function conversationView(conv: Conversation, secrets: string[]) {
	return {
		title: conv.title,
		updatedAt: conv.updatedAt,
		budget: conv.mlBudget
			? {
					spent: conv.mlBudget.spentMicroUsd,
					total: conv.mlBudget.totalMicroUsd,
					reservations: conv.mlBudget.reservations,
				}
			: undefined,
		truncated: conv.messages.filter((m) => m.from !== "system").length > 100,
		messages: conv.messages
			.filter((m) => m.from !== "system")
			.slice(-100)
			.map((m) => ({
				id: m.id,
				role: m.from,
				createdAt: m.createdAt,
				text: scrub(
					visibleText(
						m.from === "user"
							? (m.content.split("Invoking user's request:\n").at(-1) ?? m.content)
							: m.content
					),
					secrets
				),
				files: m.files?.map((f) => ({ name: f.name, mime: f.mime })),
				events: (m.updates ?? [])
					.filter((u) =>
						["tool", "status", "turnState", "budget", "notice", "plan", "elicitation"].includes(
							u.type
						)
					)
					.slice(-200)
					.map((u) => scrub(u, secrets)),
			})),
	};
}
