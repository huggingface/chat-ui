import { dev } from "$app/environment";
import { base } from "$app/paths";
import { redirect } from "@sveltejs/kit";
import { config } from "$lib/server/config";

export async function POST({ cookies }) {
	cookies.delete(config.COOKIE_NAME, {
		path: "/",
		sameSite: dev || config.ALLOW_INSECURE_COOKIES === "true" ? "lax" : "none",
		secure: !dev && !(config.ALLOW_INSECURE_COOKIES === "true"),
		httpOnly: true,
	});
	return redirect(302, `${base}/`);
}
