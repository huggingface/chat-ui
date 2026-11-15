import type { ReviewSchema } from "$lib/types/MlReview";

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

/** stamps every result, so answers under one schema never mix silently with another schema */
export async function reviewSchemaHash(
	schema: Pick<ReviewSchema, "fields" | "questions">
): Promise<string> {
	const bytes = new TextEncoder().encode(
		canonical({ fields: schema.fields, questions: schema.questions })
	);
	const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest).slice(0, 4), (b) =>
		b.toString(16).padStart(2, "0")
	).join("");
}
