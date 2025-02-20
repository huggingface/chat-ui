import Elysia from "elysia";
import { authenticateRequest } from "../auth";

export const authPlugin = new Elysia({ name: "auth" }).derive(
	{ as: "scoped" },
	async ({
		headers,
		cookie,
	}): Promise<{
		locals: App.Locals;
	}> => {
		const auth = await authenticateRequest(
			{ type: "elysia", value: headers },
			{ type: "elysia", value: cookie },
			true
		);
		return {
			locals: {
				user: auth?.user,
				sessionId: auth?.sessionId,
			},
		};
	}
);
