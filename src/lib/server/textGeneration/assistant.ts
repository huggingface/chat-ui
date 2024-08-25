import { isURLLocal } from "../isURLLocal";
import { env } from "$env/dynamic/private";
import { collections } from "$lib/server/database";
import type { Assistant } from "$lib/types/Assistant";
import type { ObjectId } from "mongodb";

export async function processPreprompt(preprompt: string) {
	const urlRegex = /{{\s?url=(.*?)\s?}}/g;

	for (const match of preprompt.matchAll(urlRegex)) {
		try {
			const url = new URL(match[1]);
			if ((await isURLLocal(url)) && env.ENABLE_LOCAL_FETCH !== "true") {
				throw new Error("URL couldn't be fetched, it resolved to a local address.");
			}

			const res = await fetch(url.href);

			if (!res.ok) {
				throw new Error("URL couldn't be fetched, error " + res.status);
			}
			const text = await res.text();
			preprompt = preprompt.replaceAll(match[0], text);
		} catch (e) {
			preprompt = preprompt.replaceAll(match[0], (e as Error).message);
		}
	}

	return preprompt;
}

export async function getAssistantById(id?: ObjectId) {
	return collections.assistants
		.findOne<Pick<Assistant, "rag" | "dynamicPrompt" | "generateSettings" | "tools">>(
			{ _id: id },
			{ projection: { rag: 1, dynamicPrompt: 1, generateSettings: 1, tools: 1 } }
		)
		.then((a) => a ?? undefined);
}

export function assistantHasWebSearch(assistant?: Pick<Assistant, "rag"> | null) {
	return (
		env.ENABLE_ASSISTANTS_RAG === "true" &&
		!!assistant?.rag &&
		(assistant.rag.allowedLinks.length > 0 ||
			assistant.rag.allowedDomains.length > 0 ||
			assistant.rag.allowAllDomains)
	);
}

export function assistantHasDynamicPrompt(assistant?: Pick<Assistant, "dynamicPrompt">) {
	return env.ENABLE_ASSISTANTS_RAG === "true" && Boolean(assistant?.dynamicPrompt);
}
