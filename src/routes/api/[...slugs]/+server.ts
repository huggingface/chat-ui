import { Elysia } from "elysia";
import { base } from "$app/paths";
import { authenticateRequest } from "$lib/server/auth";

const app = new Elysia({ prefix: `${base}/api` })
	.derive(async ({ headers, cookie }) => ({
		locals: await authenticateRequest(
			{ type: "elysia", value: headers },
			{ type: "elysia", value: cookie },
			true
		),
	}))
	.get("/foo", ({ locals }) => {
		return locals.user?._id;
	})
	.get("/bar", ({ locals }) => {
		return locals.user?.name;
	});

type RequestHandler = (v: { request: Request; locals: App.Locals }) => Response | Promise<Response>;

export const GET: RequestHandler = ({ request }) => app.handle(request);
export const POST: RequestHandler = ({ request }) => app.handle(request);
export const PUT: RequestHandler = ({ request }) => app.handle(request);
export const PATCH: RequestHandler = ({ request }) => app.handle(request);
export const DELETE: RequestHandler = ({ request }) => app.handle(request);
