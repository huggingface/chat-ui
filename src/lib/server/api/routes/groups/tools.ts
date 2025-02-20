import { Elysia } from "elysia";
import { authPlugin } from "$lib/server/api/authPlugin";

export const toolGroup = new Elysia().use(authPlugin).group("/tools", (app) => {
	return app
		.get("/", () => {
			// todo: get tools
			return "aa";
		})
		.get("/search", () => {
			// todo: search tools
			return "aa";
		})
		.group("/:id", (app) => {
			return app
				.get("/", () => {
					// todo: get tool
					return "aa";
				})
				.post("/", () => {
					// todo: post new tool
					return "aa";
				})
				.group("/:toolId", (app) => {
					return app
						.get("/", () => {
							// todo: get tool
							return "aa";
						})
						.patch("/", () => {
							// todo: patch tool
							return "aa";
						})
						.delete("/", () => {
							// todo: delete tool
							return "aa";
						})
						.post("/report", () => {
							// todo: report tool
							return "aa";
						})
						.patch("/review", () => {
							// todo: review tool
							return "aa";
						});
				});
		});
});
