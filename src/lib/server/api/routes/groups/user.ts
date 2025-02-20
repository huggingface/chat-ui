import { Elysia } from "elysia";
import { authPlugin } from "$lib/server/api/authPlugin";

export const userGroup = new Elysia()
	.use(authPlugin)
	.post("/login", () => {
		// todo: login
		return "aa";
	})
	.get("/login/callback", () => {
		// todo: login callback
		return "aa";
	})
	.post("/logout", () => {
		// todo: logout
		return "aa";
	})
	.group("/user", (app) => {
		return app
			.get("/", () => {
				// todo: get user
				return "aa";
			})
			.get("/settings", () => {
				// todo: get user settings
				return "aa";
			})
			.patch("/settings", () => {
				// todo: patch user settings
				return "aa";
			})
			.get("/assistants", () => {
				// todo: get user assistants
				return "aa";
			});
	});
