import { config } from "$lib/server/config";
import { ML_ASSISTANT_MODE } from "$lib/utils/mlAssistantFlag";

// apart from the poller so the prompt builders can ask without loading it

export function mlServicePollerEnabled(): boolean {
	return ML_ASSISTANT_MODE && config.ML_ASSISTANT_SERVICE_POLLER !== "false";
}

// one switch for marking, delivery and the prompt, a model told it will be woken must be woken,
// and only the poller finds the ends
export function mlServiceEventsEnabled(): boolean {
	return mlServicePollerEnabled() && config.ML_ASSISTANT_SERVICE_EVENTS !== "false";
}
