import { isURLLocal } from "../isURLLocal";
import { env } from "$env/dynamic/private";
import { collections } from "$lib/server/database";
import type { Assistant } from "$lib/types/Assistant";
import type { ObjectId } from "mongodb";

export async function processPreprompt(preprompt: string, user_message: string | undefined) {
	// Replace {{today}} with formatted date
	const today = new Intl.DateTimeFormat("en-US", {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
	}).format(new Date());
	preprompt = preprompt.replaceAll("{{today}}", today);
	const requestRegex = /{{\s?(get|post|url)=(.*?)\s?}}/g;

	for (const match of preprompt.matchAll(requestRegex)) {
		const method = match[1].toUpperCase();
		const urlString = match[2];
		try {
			const url = new URL(urlString);
			if ((await isURLLocal(url)) && env.ENABLE_LOCAL_FETCH !== "true") {
				throw new Error("URL couldn't be fetched, it resolved to a local address.");
			}

			let res;
			if (method == "POST") {
				res = await fetch(url.href, {
					method: "POST",
					body: user_message,
					headers: {
						"Content-Type": "text/plain",
					},
				});
			} else if (method == "GET" || method == "URL") {
				res = await fetch(url.href);
			} else {
				throw new Error("Invalid method " + method);
			}

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
