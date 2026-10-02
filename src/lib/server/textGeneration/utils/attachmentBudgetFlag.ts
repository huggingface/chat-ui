import { config } from "$lib/server/config";

export function attachmentBudgetEnabled(): boolean {
	return config.ATTACHMENT_BUDGET !== "false";
}
