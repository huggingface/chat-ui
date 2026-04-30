import { z } from "zod";
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { tryRevokeToken } from "$lib/server/mcp/oauth/exchange";
import type {
	AuthorizationServerMetadata,
	OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js";

const Body = z.object({
	asMetadata: z.record(z.string(), z.unknown()),
	clientInfo: z.record(z.string(), z.unknown()),
	token: z.string().min(1),
	token_type_hint: z.enum(["access_token", "refresh_token"]).optional(),
});

export const POST: RequestHandler = async ({ request }) => {
	let parsed: z.infer<typeof Body>;
	try {
		parsed = Body.parse(await request.json());
	} catch (e) {
		return error(400, e instanceof Error ? e.message : "Invalid request body");
	}

	const asMetadata = parsed.asMetadata as unknown as AuthorizationServerMetadata;
	const clientInfo = parsed.clientInfo as unknown as OAuthClientInformationFull;

	const ok = await tryRevokeToken({
		asMetadata,
		clientInfo,
		token: parsed.token,
		tokenTypeHint: parsed.token_type_hint,
	});
	return json({ revoked: ok });
};
