import { Elysia } from "elysia";
import { base } from "$app/paths";
import { authPlugin } from "$lib/server/api/authPlugin";
import { conversationGroup } from "$lib/server/api/routes/groups/conversations";
import { assistantGroup } from "$lib/server/api/routes/groups/assistants";
import { userGroup } from "$lib/server/api/routes/groups/user";
import { toolGroup } from "$lib/server/api/routes/groups/tools";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import { misc } from "$lib/server/api/routes/groups/misc";
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
	.use(misc);

export type App = typeof app;
