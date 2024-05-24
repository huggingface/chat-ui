import { env } from "$env/dynamic/private";
import { Client } from "@gradio/client";
import { collections } from "../database";
import { SignJWT } from "jose";
import type { Conversation } from "$lib/types/Conversation";

export type GradioImage = {
	path: string;
	url: string;
	orig_name: string;
	is_stream: boolean;
	meta: Record<string, unknown>;
};

type GradioResponse = {
	data: unknown[];
};

export async function callSpace<TInput extends unknown[], TOutput extends unknown[]>(
	name: string,
	func: string,
	parameters: TInput,
	ipToken: string | undefined
): Promise<TOutput> {
	class CustomClient extends Client {
		fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
			init = init || {};
			init.headers = {
				...(init.headers || {}),
				...(ipToken ? { "X-IP-Token": ipToken } : {}),
			};
			return super.fetch(input, init);
		}
	}

	const client = await CustomClient.connect(name, {
		hf_token: (env.HF_TOKEN ?? env.HF_ACCESS_TOKEN) as unknown as `hf_${string}`,
	});
	return await client
		.predict(func, parameters)
		.then((res) => (res as unknown as GradioResponse).data as TOutput);
}

export async function getIpToken(sessionId: Conversation["sessionId"]) {
	const ipTokenSecret = env.IP_TOKEN_SECRET;
	if (!ipTokenSecret) {
		return;
	}
	const session = await collections.sessions.findOne({ sessionId });
	return await new SignJWT({ ip: session?.ip ?? "", user: session?.userId ?? "" })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime("1m")
		.sign(new TextEncoder().encode(ipTokenSecret));
}

export { toolHasName } from "$lib/utils/tools";
