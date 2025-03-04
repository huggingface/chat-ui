import { Elysia } from "elysia";
import { authPlugin } from "$lib/server/api/authPlugin";
import { ReviewStatus } from "$lib/types/Review";
import { toolFromConfigs } from "$lib/server/tools";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import type { ToolFront, ToolInputFile } from "$lib/types/Tool";
import { MetricsServer } from "$lib/server/metrics";
import { authCondition } from "$lib/server/auth";

export type GETToolsResponse = Array<ToolFront>;

export const toolGroup = new Elysia().use(authPlugin).group("/tools", (app) => {
	return app
		.get("/config", async () => {
			const toolUseDuration = (await MetricsServer.getMetrics().tool.toolUseDuration.get()).values;

			return toolFromConfigs
				.filter((tool) => !tool?.isHidden)
				.map(
					(tool) =>
						({
							_id: tool._id.toString(),
							type: tool.type,
							displayName: tool.displayName,
							name: tool.name,
							description: tool.description,
							mimeTypes: (tool.inputs ?? [])
								.filter((input): input is ToolInputFile => input.type === "file")
								.map((input) => (input as ToolInputFile).mimeTypes)
								.flat(),
							isOnByDefault: tool.isOnByDefault ?? true,
							isLocked: tool.isLocked ?? true,
							timeToUseMS:
								toolUseDuration.find(
									(el) => el.labels.tool === tool._id.toString() && el.labels.quantile === 0.9
								)?.value ?? 15_000,
							color: tool.color,
							icon: tool.icon,
						}) satisfies ToolFront
				);
		})
		.get("/active", async ({ locals }) => {
			const settings = await collections.settings.findOne(authCondition(locals));

			if (!settings) {
				return [];
			}

			const activeCommunityToolIds = settings.tools ?? [];

			const communityTools = await collections.tools
				.find({ _id: { $in: activeCommunityToolIds.map((el) => new ObjectId(el)) } })
				.toArray()
				.then((tools) =>
					tools.map((tool) => ({
						...tool,
						isHidden: false,
						isOnByDefault: true,
						isLocked: true,
					}))
				);

			return communityTools;
		})
		.get("/search", () => {
			// todo: search tools
			return "aa";
		})
		.get("/count", () => {
			// return community tool count
			return collections.tools.countDocuments({ type: "community", review: ReviewStatus.APPROVED });
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
