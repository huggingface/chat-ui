import { models } from "$lib/server/models";

export async function GET() {
	return Response.json(models);
}
