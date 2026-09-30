import type { ObjectId } from "mongodb";
import { logger } from "$lib/server/logger";
import { serviceEventText } from "$lib/server/textGeneration/builtinTools/waitTool";
import {
	MessageUpdateType,
	type HarnessServiceEvent,
	type MessageHarnessEventUpdate,
} from "$lib/types/MessageUpdate";
import type { MlService, ServiceEvent } from "$lib/types/MlService";
import { markServiceEventsReported, pendingServiceEvents, serviceEventFrom } from "./events";

const HARNESS_EVENT_HEADER = "[Harness event, not part of this tool result]";

export function harnessEventText(events: ServiceEvent[]): string {
	return [HARNESS_EVENT_HEADER, ...events.map(serviceEventText)].join("\n");
}

const plainEvent = ({ serviceId, at, ...rest }: ServiceEvent): HarnessServiceEvent => ({
	...rest,
	serviceId: serviceId.toString(),
	at: at.getTime(),
});

export interface PendingHarnessEvent {
	update: MessageHarnessEventUpdate;
	services: MlService[];
}

/** read only, the caller emits the update before markHarnessEventDelivered clears the rows */
export async function pendingHarnessEvent(
	conversationId: ObjectId,
	afterToolUuid: string,
	now = new Date()
): Promise<PendingHarnessEvent | undefined> {
	try {
		const services = await pendingServiceEvents(conversationId);
		if (services.length === 0) return undefined;
		const events = services.map((service) => serviceEventFrom(service, now));
		return {
			update: {
				type: MessageUpdateType.HarnessEvent,
				events: events.map(plainEvent),
				text: harnessEventText(events),
				afterToolUuid,
			},
			services,
		};
	} catch (err) {
		logger.error(
			{ err, conversationId: conversationId.toString() },
			"[mlEvents] could not read pending events mid-turn"
		);
		return undefined;
	}
}

export async function markHarnessEventDelivered(
	conversationId: ObjectId,
	services: MlService[],
	now = new Date()
): Promise<void> {
	try {
		const marked = await markServiceEventsReported(services, now);
		logger.info(
			{
				conversationId: conversationId.toString(),
				events: services.map(({ jobId, kind, stage }) => ({ jobId, kind, stage })),
				alsoDeliveredElsewhere: services.length - marked.length,
			},
			"[mlEvents] delivered mid-turn"
		);
	} catch (err) {
		logger.error(
			{ err, conversationId: conversationId.toString() },
			"[mlEvents] could not mark mid-turn events delivered, they will be told again"
		);
	}
}
