import { config } from "$lib/server/config";

export function getApiToken(_locals: App.Locals | undefined) {
	return config.OPENAI_API_KEY;
}
