import { Elysia } from "elysia";
import { authPlugin } from "$lib/server/api/authPlugin";
import { ReviewStatus } from "$lib/types/Review";
import { toolFromConfigs } from "$lib/server/tools";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";

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
				.derive(async ({ params, error, locals }) => {
					const tool = await collections.tools.findOne({ _id: new ObjectId(params.id) });

					if (!tool) {
						const tool = toolFromConfigs.find((el) => el._id.toString() === params.id);
						if (!tool) {
							throw error(404, "Tool not found");
						} else {
							return {
								tool: {
									...tool,
									_id: tool._id.toString(),
									call: undefined,
									createdById: null,
									createdByName: null,
									createdByMe: false,
									reported: false,
									review: ReviewStatus.APPROVED,
								},
							};
						}
					} else {
						const reported = await collections.reports.findOne({
							contentId: tool._id,
							object: "tool",
						});

						return {
							tool: {
								...tool,
								_id: tool._id.toString(),
								call: undefined,
								createdById: tool.createdById.toString(),
								createdByMe:
									tool.createdById.toString() === (locals.user?._id ?? locals.sessionId).toString(),
								reported: !!reported,
							},
						};
					}
				})
				.get("", ({ tool }) => {
					return tool;
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
