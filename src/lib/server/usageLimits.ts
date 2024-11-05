import { z } from "zod";
import { env } from "$env/dynamic/private";
import JSON5 from "json5";

// RATE_LIMIT is the legacy way to define messages per minute limit
export const usageLimitsSchema = z
	.object({
		conversations: z.coerce.number().optional(), // how many conversations
		messages: z.coerce.number().optional(), // how many messages in a conversation
		assistants: z.coerce.number().optional(), // how many assistants
		messageLength: z.coerce.number().optional(), // how long can a message be before we cut it off
		messagesPerMinute: z
			.preprocess((val) => {
				if (val === undefined) {
					return env.RATE_LIMIT;
				}
				return val;
			}, z.coerce.number().optional())
			.optional(), // how many messages per minute
	})
	.optional();

export const usageLimits = usageLimitsSchema.parse(JSON5.parse(env.USAGE_LIMITS));
