import { z } from "zod";
import { RATE_LIMITS, RATE_LIMIT } from "$env/static/private";
import JSON5 from "json5";

// RATE_LIMIT is the legacy way to define messages per minute limit
export const rateLimitsSchema = z
	.object({
		conversations: z.coerce.number().optional(), // how many conversations
		messages: z.coerce.number().optional(), // how many messages in a conversation
		assistants: z.coerce.number().optional(), // how many assistants
		messagesPerMinute: z
			.preprocess((val) => {
				if (val === undefined) {
					return RATE_LIMIT;
				}
				return val;
			}, z.coerce.number().optional())
			.optional(), // how many messages per minute
	})
	.optional();

export const RateLimits = rateLimitsSchema.parse(JSON5.parse(RATE_LIMITS));
