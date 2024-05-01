import { register } from "$lib/server/metrics";

export async function GET() {
	return new Response(await register.metrics(), {
		headers: {
			"Content-Type": register.contentType,
		},
	});
}
