import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import type { EndpointMessage } from "../endpoints/endpoints";
import type { Route, RouteConfig } from "./types";
import { getRoutes } from "./policy";

const DEFAULT_LAST_TURNS = 16;
const PROMPT_TEMPLATE = `
You are a helpful assistant designed to find the best suited route.
You are provided with route description within <routes></routes> XML tags:

<routes>

{routes}

</routes>

<conversation>

{conversation}

</conversation>

Your task is to decide which route is best suit with user intent on the conversation in <conversation></conversation> XML tags.

Follow those instructions:
1. Use prior turns to choose the best route for the current message if needed.
2. If no route match the full conversation respond with other route {"route": "other"}.
3. Analyze the route descriptions and find the best match route for user latest intent.
4. Respond only with the route name that best matches the user's request, using the exact name in the <routes> block.
Based on your analysis, provide your response in the following JSON format if you decide to match any route:
{"route": "route_name"}
`.trim();

function lastNTurns<T>(arr: T[], n = DEFAULT_LAST_TURNS) {
	if (!Array.isArray(arr)) return [] as T[];
	return arr.slice(-n);
}

function toRouterPrompt(messages: EndpointMessage[], routes: Route[]) {
	const simpleRoutes: RouteConfig[] = routes.map((r) => ({
		name: r.name,
		description: r.description,
	}));
	const convo = messages
		.map((m) => ({ role: m.from, content: m.content }))
		.filter((m) => typeof m.content === "string" && m.content.trim() !== "");
	return PROMPT_TEMPLATE.replace("{routes}", JSON.stringify(simpleRoutes)).replace(
		"{conversation}",
		JSON.stringify(lastNTurns(convo))
	);
}

function parseRouteName(text: string): string | undefined {
	if (!text) return;
	try {
		const obj = JSON.parse(text);
		if (typeof obj?.route === "string" && obj.route.trim()) return obj.route.trim();
	} catch {}
	const m = text.match(/["']route["']\s*:\s*["']([^"']+)["']/);
	if (m?.[1]) return m[1].trim();
	try {
		const obj = JSON.parse(text.replace(/'/g, '"'));
		if (typeof obj?.route === "string" && obj.route.trim()) return obj.route.trim();
	} catch {}
	return;
}

export async function archSelectRoute(
	messages: EndpointMessage[],
	traceId?: string
): Promise<{ routeName: string }> {
	const routes = await getRoutes();
	const prompt = toRouterPrompt(messages, routes);

	const baseURL = (config.LLM_ROUTER_ARCH_BASE_URL || "").replace(/\/$/, "");
	const archModel = config.LLM_ROUTER_ARCH_MODEL || "router/omni";

	if (!baseURL) {
		logger.warn("LLM_ROUTER_ARCH_BASE_URL not set; routing will fail over to fallback.");
		return { routeName: "arch_router_failure" };
	}

	const headers: HeadersInit = {
		Authorization: `Bearer ${config.OPENAI_API_KEY || config.HF_TOKEN}`,
		"Content-Type": "application/json",
	};
	const body = {
		model: archModel,
		messages: [{ role: "user", content: prompt }],
		temperature: 0,
		max_tokens: 16,
		stream: false,
	};

	const ctrl = new AbortController();
	const timeoutMs = Number(config.LLM_ROUTER_ARCH_TIMEOUT_MS || 10000);
	const to = setTimeout(() => ctrl.abort(), timeoutMs);

	try {
		const resp = await fetch(`${baseURL}/chat/completions`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: ctrl.signal,
		});
		clearTimeout(to);
		if (!resp.ok) throw new Error(`arch-router ${resp.status}`);
		const data: { choices: { message: { content: string } }[] } = await resp.json();
		const text = (data?.choices?.[0]?.message?.content ?? "").toString().trim();
		const raw = parseRouteName(text);

		const other = config.LLM_ROUTER_OTHER_ROUTE || "casual_conversation";
		const chosen = raw === "other" ? other : raw || "casual_conversation";
		const exists = routes.some((r) => r.name === chosen);
		return { routeName: exists ? chosen : "casual_conversation" };
	} catch (e) {
		clearTimeout(to);
		logger.warn({ err: String(e), traceId }, "arch router selection failed");
		return { routeName: "arch_router_failure" };
	}
}
