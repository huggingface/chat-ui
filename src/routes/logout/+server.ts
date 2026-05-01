import { base } from "$app/paths";
import { collections } from "$lib/server/database";
import { redirect } from "@sveltejs/kit";
import { config } from "$lib/server/config";
import { sameSite, secure } from "$lib/server/auth";

export async function POST({ locals, cookies }) {
	await collections.sessions.deleteOne({ sessionId: locals.sessionId });

	cookies.delete(config.COOKIE_NAME, {
		path: "/",
		// So that it works inside the space's iframe
		sameSite,
		secure,
		httpOnly: true,
	});
	return redirect(302, `${base}/`);
}
