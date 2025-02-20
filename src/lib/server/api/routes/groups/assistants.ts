import { Elysia } from "elysia";
import { authPlugin } from "$lib/server/api/authPlugin";

export const assistantGroup = new Elysia().use(authPlugin).group("/assistants", (app) => {
	return app
		.get("/", () => {
			// todo: get assistants
			return "aa";
		})
		.post("/", () => {
			// todo: post new assistant
			return "aa";
		})
		.group("/:id", (app) => {
			return app
				.get("/", () => {
					// todo: get assistant
					return "aa";
				})
				.patch("/", () => {
					// todo: patch assistant
					return "aa";
				})
				.delete("/", () => {
					// todo: delete assistant
					return "aa";
				})
				.post("/report", () => {
					// todo: report assistant
					return "aa";
				})
				.patch("/review", () => {
					// todo: review assistant
					return "aa";
				})
				.post("/subscribe", () => {
					// todo: subscribe to assistant
					return "aa";
				})
				.delete("/subscribe", () => {
					// todo: unsubscribe from assistant
					return "aa";
				});
		});
});
