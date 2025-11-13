import { Elysia } from "elysia";
import { authPlugin } from "$api/authPlugin";
import { DEFAULT_SETTINGS } from "$lib/types/Settings";

export const userGroup = new Elysia()
	.use(authPlugin)
	.get("/login", () => {
		// todo: login
		throw new Error("Not implemented");
	})
	.get("/login/callback", () => {
		// todo: login callback
		throw new Error("Not implemented");
	})
	.post("/logout", () => {
		// todo: logout
		throw new Error("Not implemented");
	})
	.group("/user", (app) => {
		return app
			.get("/", ({ locals }) => {
				return locals.user
					? {
							id: locals.user._id.toString(),
							username: locals.user.username,
							avatarUrl: locals.user.avatarUrl,
							email: locals.user.email,
							isAdmin: locals.user.isAdmin ?? false,
							isEarlyAccess: locals.user.isEarlyAccess ?? false,
						}
					: null;
			})
			.get("/settings", async () => {
				// Settings are now stored client-side in IndexedDB
				// Return default settings - client loads from IndexedDB
				return {
					welcomeModalSeen: false,
					welcomeModalSeenAt: null,
					activeModel: "", // Will be set from models list on client side
					disableStream: DEFAULT_SETTINGS.disableStream,
					directPaste: DEFAULT_SETTINGS.directPaste,
					hidePromptExamples: DEFAULT_SETTINGS.hidePromptExamples,
					shareConversationsWithModelAuthors: DEFAULT_SETTINGS.shareConversationsWithModelAuthors,
					customPrompts: {},
					multimodalOverrides: {},
				};
			})
			.post("/settings", async () => {
				// Settings are now stored client-side in IndexedDB
				// This endpoint is kept for backward compatibility but does nothing
				return new Response();
			})
			.get("/reports", async () => {
				// Reports functionality is not required
				return [];
			});
	});
