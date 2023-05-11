import { redirect, error } from "@sveltejs/kit";
import { validateCsrfToken } from "$lib/server/auth";
import { z } from "zod";

export async function GET({ url, locals }) {
	// // http://localhost:5173/login/callback?code=123&state=aHR0cDovL2xvY2FsaG9zdDo1MTczL2xvZ2luL2NhbGxiYWNrfGV5SmtZWFJoSWpwN0ltVjRjR2x5WVhScGIyNGlPakUyT0RNNE9ESTROalE0T1Rrc0luTmxjM05wYjI1SlpDSTZJbVY1U21oaVIyTnBUMmxLYTJGWVNXbE1RMHBzWW0xTmFVOXBTa0pOYWxVeVVqQk9Ua2x1TUM0dVkxUTVRVXB6WjBVMk1uTkhkV1pQT1M0Mk5WbGZkR2x6UWtkYVgzWlhiRFpaVTB0UmMxbFhjV2hqWHpKRFlqUkVaRzFPWnpOZmJGTllWelprVFRFd1ZsOXJiMmxmY0V4QlZISldMVFV6WVdSbVFucG9RamxwVFdGQ2VUUkJYeTFDUmtaME5FNWtRbkpXTm1sQ1UxbGpkbTFrWmxGTFgyeGtTazFtWlZCT2QxVTFjMWxzVFROeVNWOWtUMnhsYTJGZldIZENWR3RyVmtjeGEwWlpOMW8wYUZKUWJtbE5OR2xEUVUxNE5saHVVVGt3ZDFWRmJGTmxSWFZ2VkdWUVVVUjFOa0ZwZEZwdGFrTTBhR3BKUkdOaVh6TldMV0p1V1VkTlluZ3hXSG90ZUUxaldtbEVXRGszWkcxT1kwUlBRWFpEVmtsM1QxVTBhRlY1U25Sa1IweGlkRzFOY2tGTVYycHZhbmd3YWxZMVJHSmFNMHN5UjIxU2QyTkhNbXRNY2tkSFdIRm5hRzFvVURndVFURkJlbWxVTjBOeU15MDRabE56V2t4Mk9GUmpkeUo5TENKemFXZHVZWFIxY21VaU9pSXhOR1EwT1dVMFpUWTRObVl5T1dFMFpHTTROekE1WVdOa01HUTRPRFU1T1dKa01qSTBNV1k1TnpaalpqRXdZV0psWlRNek9HWmtabUZoTTJZME5qTTNJbjA9
	const { code, state } = z
		.object({
			code: z.string(),
			state: z.string(),
		})
		.parse(url.searchParams);

	const [redirectURI, csrfToken] = Buffer.from(state, "base64").toString("utf-8").split("|");

	console.log(code);
	console.log(state);
	console.log(redirectURI);
	console.log(csrfToken);

	if (!validateCsrfToken(csrfToken, locals.sessionId)) {
		throw error(403, "Invalid or expired CSRF token");
	}

	throw redirect(303, "/");
}
