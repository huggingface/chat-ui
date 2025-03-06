import { authPlugin } from "$api/authPlugin";
import { conversationGroup } from "$api/routes/groups/conversations";
import { assistantGroup } from "$api/routes/groups/assistants";
import { userGroup } from "$api/routes/groups/user";
import { toolGroup } from "$api/routes/groups/tools";
import { misc } from "$api/routes/groups/misc";
import { modelGroup } from "$api/routes/groups/models";

import { Elysia } from "elysia";
import { base } from "$app/paths";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";

const prefix = `${base}/api/v2` as unknown as "";

export const app = new Elysia({ prefix })
	.use(
		swagger({
			documentation: {
				info: {
					title: "Elysia Documentation",
					version: "1.0.0",
				},
			},
			provider: "swagger-ui",
		})
	)
	.use(cors())
	.use(authPlugin)
	.use(conversationGroup)
	.use(toolGroup)
	.use(assistantGroup)
	.use(userGroup)
	.use(modelGroup)
	.use(misc);

export type App = typeof app;
