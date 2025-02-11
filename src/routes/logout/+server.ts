import { dev } from "$app/environment";
import { base } from "$app/paths";
import { env } from "$env/dynamic/private";
import { collections } from "$lib/server/database";
import { redirect } from "@sveltejs/kit";

export async function POST({ locals, cookies }) {
	await collections.sessions.deleteOne({ sessionId: locals.sessionId });

	cookies.delete(env.COOKIE_NAME, {
		path: "/",
		// So that it works inside the space's iframe
		sameSite: dev || env.ALLOW_INSECURE_COOKIES === "true" ? "lax" : "none",
		secure: !dev && !(env.ALLOW_INSECURE_COOKIES === "true"),
		httpOnly: true,
	});
	return redirect(302, `${base}/`);
}
