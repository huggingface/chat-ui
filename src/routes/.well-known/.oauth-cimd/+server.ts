import { OIDConfig } from "$lib/server/auth";
import { config } from "$lib/server/config";

export const GET = ({ url }) => {
	if (!OIDConfig.CLIENT_ID) {
		return new Response("Client ID not found", { status: 404 });
	}
	if (OIDConfig.CLIENT_ID !== "__CIMD__") {
		return new Response("Client ID is manually set to something other than '__CIMD__'", {
			status: 404,
		});
	}
	return new Response(
		JSON.stringify({
			client_id: new URL("/.well-known/oauth-cimd", config.PUBLIC_ORIGIN || url.origin).toString(),
			client_name: config.PUBLIC_APP_NAME,
			redirect_uris: [new URL("/login/callback", config.PUBLIC_ORIGIN || url.origin).toString()],
			token_endpoint_auth_method: "none",
			scopes: OIDConfig.SCOPES,
		}),
		{
			headers: {
				"Content-Type": "application/json",
			},
		}
	);
};
