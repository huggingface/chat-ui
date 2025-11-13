// Admin tokens are no longer supported
import { z } from "zod";

const validateTokenSchema = z.object({
	token: z.string(),
});

export const POST = async ({ request }) => {
	const { success } = validateTokenSchema.safeParse(await request.json());

	if (!success) {
		return new Response(JSON.stringify({ error: "Invalid token" }), { status: 400 });
	}

	return new Response(JSON.stringify({ valid: false }));
};
