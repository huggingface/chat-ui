import { providerEntra } from "$lib/server/providers/microsoft_entra/providerEntra";
import type { Cookies } from "@sveltejs/kit";
import type { Model } from "$lib/types/Model";

export interface ProviderParameters {
	idToken?: string;
}

export interface AccessToken {
	value: string;
	refreshToken: string;
}

export type Provider<ProviderParametersType extends ProviderParameters> = {
	// getAccessToken should also set providerParameters.idToken to undefined after use and return the new providerParameters
	getAccessToken: (
		cookies: Cookies,
		providerParameters: ProviderParametersType
	) => Promise<[AccessToken, ProviderParametersType]>;
	refreshAccessToken: (
		cookies: Cookies,
		accessToken: AccessToken,
		providerParameters: ProviderParametersType
	) => Promise<AccessToken>;
	getUserGroups: (
		accessToken: AccessToken,
		providerParameters: ProviderParametersType
	) => Promise<string[]>;
};

// I'd like to annotate this type but could not figure out how to do so without getting errors
// The value for each entry needs to be Provider<any type that extends ProviderParameters>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const providers: Record<string, Provider<any>> = {
	entra: providerEntra,
};

export async function getAllowedModels(models: Model[], user_groups: string[]): Promise<string[]> {
	return models
		.filter(
			(model) =>
				!model.allowed_groups || model.allowed_groups.some((group) => user_groups.includes(group))
		)
		.map((model) => model.id);
}
