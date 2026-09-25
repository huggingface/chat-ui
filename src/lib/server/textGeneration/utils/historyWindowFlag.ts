import { config } from "$lib/server/config";

export function historyWindowEnabled(): boolean {
	return config.HISTORY_SLIDING_WINDOW !== "false";
}
