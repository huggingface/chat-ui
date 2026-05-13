import { validateMcpServerUrl } from "$lib/utils/mcpValidation";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => {
	const rawName = url.searchParams.get("name")?.trim() ?? "";
	const rawUrl = url.searchParams.get("url")?.trim() ?? "";

	const name = rawName.slice(0, 100);
	const validatedUrl = rawUrl ? validateMcpServerUrl(rawUrl) : null;

	return {
		name,
		url: validatedUrl,
		invalid: !name || !validatedUrl,
	};
};
