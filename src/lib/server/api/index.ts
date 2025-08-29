import { authPlugin } from "$api/authPlugin";
import { conversationGroup } from "$api/routes/groups/conversations";
import { userGroup } from "$api/routes/groups/user";
import { misc } from "$api/routes/groups/misc";
import { modelGroup } from "$api/routes/groups/models";
import { debugGroup } from "$api/routes/groups/debug";

import { Elysia } from "elysia";
import { base } from "$app/paths";
import { swagger } from "@elysiajs/swagger";
import { config } from "$lib/server/config";

import superjson from "superjson";

const prefix = `${base}/api/v2` as unknown as "";

export const app = new Elysia({ prefix })
	.mapResponse(({ response, request }) => {
		// Skip the /export endpoint
		if (request.url.endsWith("/export")) {
			return response as unknown as Response;
		}
		return new Response(superjson.stringify(response), {
			headers: {
				"Content-Type": "application/json",
			},
		});
	})
	.use(
		swagger({
			documentation: {
				info: {
					title: "chat-ui API",
					version: config.PUBLIC_VERSION,
				},
			},
			provider: "swagger-ui",
			path: `swagger`,
		})
	)
	.use(authPlugin)
	.use(conversationGroup)
	.use(userGroup)
	.use(modelGroup)
	.use(misc)
	.use(debugGroup);

export type App = typeof app;
