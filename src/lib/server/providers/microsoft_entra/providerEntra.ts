import { OIDConfig, ProviderCookieNames } from "$lib/server/auth";
import type { Cookies } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { dev } from "$app/environment";
import { addDays } from "date-fns";
import type { AccessToken, Provider, ProviderParameters } from "$lib/server/providers/providers";

interface EntraProviderParameters extends ProviderParameters {
	userTid: string;
	userOid: string;
}

export const providerEntra: Provider<EntraProviderParameters> = {
	getAccessToken,
	refreshAccessToken: refreshMicrosoftGraphToken,
	getUserGroups: getUserEntraGroups,
};

async function getAccessToken(
	cookies: Cookies,
	providerParameters: EntraProviderParameters
): Promise<[AccessToken, EntraProviderParameters]> {
	if (!providerParameters.idToken) {
		throw new Error("ID Token is initially required to get an access token.");
	}

	const urlSearchParams = new URLSearchParams({
		client_id: OIDConfig.CLIENT_ID,
		client_secret: OIDConfig.CLIENT_SECRET,
		grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
		assertion: providerParameters.idToken,
		scope: "openid profile email offline_access",
		requested_token_use: "on_behalf_of",
	});
	const response = await fetch(
		`https://login.microsoft.com/${providerParameters.userTid}/oauth2/v2.0/token`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: urlSearchParams,
		}
	);
	const data = await response.json();

	const accessToken: AccessToken = {
		value: data.access_token,
		refreshToken: data.refresh_token,
	};

	// Set idToken to undefined after we use it the first time
	// This forces the app to use the refreshToken for subsequent requests
	// While the idToken could be used for more requests (until it expires),
	//   it's simpler to just use the refreshToken for all requests after the first
	const newProviderParameters = {
		...providerParameters,
		idToken: undefined,
	};

	cookies.set(ProviderCookieNames.ACCESS_TOKEN, JSON.stringify(accessToken), {
		path: env.APP_BASE || "/",
		// So that it works inside the space's iframe
		sameSite: dev || env.ALLOW_INSECURE_COOKIES === "true" ? "lax" : "none",
		secure: !dev && !(env.ALLOW_INSECURE_COOKIES === "true"),
		httpOnly: true,
		expires: addDays(new Date(), 1),
	});

	cookies.set(ProviderCookieNames.PROVIDER_PARAMS, JSON.stringify(newProviderParameters), {
		path: env.APP_BASE || "/",
		// So that it works inside the space's iframe
		sameSite: dev || env.ALLOW_INSECURE_COOKIES === "true" ? "lax" : "none",
		secure: !dev && !(env.ALLOW_INSECURE_COOKIES === "true"),
		httpOnly: true,
		expires: addDays(new Date(), 1),
	});

	return [accessToken, newProviderParameters];
}

async function refreshMicrosoftGraphToken(
	cookies: Cookies,
	accessToken: AccessToken,
	providerParameters: EntraProviderParameters
): Promise<AccessToken> {
	const urlSearchParams = new URLSearchParams({
		client_id: OIDConfig.CLIENT_ID,
		client_secret: OIDConfig.CLIENT_SECRET,
		grant_type: "refresh_token",
		refresh_token: accessToken.refreshToken,
		scope: "openid profile email offline_access", // offline_access required to get refresh_token
	});
	const response = await fetch(
		`https://login.microsoft.com/${providerParameters.userTid}/oauth2/v2.0/token`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: urlSearchParams,
		}
	);
	const data = await response.json();

	const refreshedAccessToken: AccessToken = {
		value: data.access_token,
		refreshToken: data.refresh_token,
	};

	cookies.set(ProviderCookieNames.ACCESS_TOKEN, JSON.stringify(refreshedAccessToken), {
		path: env.APP_BASE || "/",
		// So that it works inside the space's iframe
		sameSite: dev || env.ALLOW_INSECURE_COOKIES === "true" ? "lax" : "none",
		secure: !dev && !(env.ALLOW_INSECURE_COOKIES === "true"),
		httpOnly: true,
		expires: addDays(new Date(), 1),
	});

	return refreshedAccessToken;
}

async function getUserEntraGroups(
	accessToken: AccessToken,
	providerParameters: EntraProviderParameters
): Promise<string[]> {
	// Get this user's groups via Microsoft Graph API
	const response = await fetch(
		`https://graph.microsoft.com/v1.0/users/${providerParameters.userOid}/getMemberGroups`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken.value}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				securityEnabledOnly: false,
			}),
		}
	);
	const data = await response.json();
	return data.value;
}
