import { Elysia } from "elysia";
import { config } from "$lib/server/config";

export const debugGroup = new Elysia().group("/debug", (app) =>
	app
		.get("/config", async () => {
			const { models } = await import("$lib/server/models");
			return {
				OPENAI_BASE_URL: config.OPENAI_BASE_URL,
				OPENAI_API_KEY_SET: Boolean(config.OPENAI_API_KEY || config.HF_TOKEN),
				LEGACY_HF_TOKEN_SET: Boolean(config.HF_TOKEN && !config.OPENAI_API_KEY),
				MODELS_COUNT: models.length,
				NODE_VERSION: process.versions.node,
			};
		})
		.get("/refresh", async () => {
			const base = (config.OPENAI_BASE_URL || "https://router.huggingface.co/v1").replace(/\/$/, "");
			const res = await fetch(`${base}/models`);
			const body = await res.text();
			let parsed: unknown;
			try {
				parsed = JSON.parse(body);
			} catch {}
			return {
				status: res.status,
				ok: res.ok,
				base,
				length:
					typeof parsed === "object" && parsed && "data" in (parsed as any)
						? ((parsed as any).data?.length ?? null)
						: null,
				sample: body.slice(0, 2000),
			};
		})
);
