import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { config } from "$lib/server/config";
import { oauthCallbackUri, oauthClientMetadataUri } from "$lib/server/mcp/oauth/redirect";

export const GET: RequestHandler = async ({ url }) => {
	const clientId = oauthClientMetadataUri(url);
	if (new URL(clientId).protocol !== "https:") {
		return new Response("Client ID metadata documents require HTTPS", { status: 404 });
	}

	return json(
		{
			client_id: clientId,
			client_name: config.PUBLIC_APP_NAME || "chat-ui",
			redirect_uris: [oauthCallbackUri(url)],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		},
		{
			headers: {
				"Cache-Control": "public, max-age=3600",
				"Content-Type": "application/json",
				"X-Content-Type-Options": "nosniff",
			},
		}
	);
};
