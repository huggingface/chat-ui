import Elysia from "elysia";
import { authenticateRequest } from "../auth";
import { config } from "../config";

export const authPlugin = new Elysia({ name: "auth" }).derive(
	{ as: "scoped" },
	async ({
		headers,
		cookie,
		request,
	}): Promise<{
		locals: App.Locals;
	}> => {
		const auth = await authenticateRequest(
			{ type: "elysia", value: headers },
			{ type: "elysia", value: cookie },
			new URL(request.url, config.PUBLIC_ORIGIN || undefined),
			true
		);
		return {
			locals: {
				user: auth?.user,
				sessionId: auth?.sessionId,
				isAdmin: auth?.isAdmin,
				token: auth?.token,
			},
		};
	}
);
