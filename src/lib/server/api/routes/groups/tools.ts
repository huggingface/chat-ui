import { Elysia, t } from "elysia";
import { authPlugin } from "$api/authPlugin";
import { ReviewStatus } from "$lib/types/Review";
import { toolFromConfigs } from "$lib/server/tools";
import { collections } from "$lib/server/database";
import { ObjectId, type Filter } from "mongodb";
import type { CommunityToolDB, ConfigTool, ToolFront, ToolInputFile } from "$lib/types/Tool";
import { MetricsServer } from "$lib/server/metrics";
import { authCondition } from "$lib/server/auth";
import { SortKey } from "$lib/types/Assistant";
import type { User } from "$lib/types/User";
import { generateQueryTokens, generateSearchTokens } from "$lib/utils/searchTokens";
import { env } from "$env/dynamic/private";
import { jsonSerialize, type Serialize } from "$lib/utils/serialize";

const NUM_PER_PAGE = 16;

export type GETToolsResponse = Array<ToolFront>;
export type GETToolsSearchResponse = {
	tools: Array<Serialize<ConfigTool | CommunityToolDB>>;
	numTotalItems: number;
	numItemsPerPage: number;
	query: string | null;
	sort: SortKey;
	showUnfeatured: boolean;
};

export const toolGroup = new Elysia().use(authPlugin).group("/tools", (app) => {
	return app
		.get("/active", async ({ locals }) => {
			const settings = await collections.settings.findOne(authCondition(locals));

			if (!settings) {
				return [];
			}

			const toolUseDuration = (await MetricsServer.getMetrics().tool.toolUseDuration.get()).values;

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

			const fullTools = [...communityTools, ...toolFromConfigs];

			return fullTools
				.filter((tool) => !tool.isHidden)
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
		.get(
			"/search",
			async ({ query, locals, error }) => {
				if (env.COMMUNITY_TOOLS !== "true") {
					error(403, "Community tools are not enabled");
				}

				const username = query.user;
				const search = query.q?.trim() ?? null;

				const pageIndex = query.p ?? 0;
				const sort = query.sort ?? SortKey.TRENDING;
				const createdByCurrentUser = locals.user?.username && locals.user.username === username;
				const activeOnly = query.active ?? false;
				const showUnfeatured = query.showUnfeatured ?? false;

				let user: Pick<User, "_id"> | null = null;
				if (username) {
					user = await collections.users.findOne<Pick<User, "_id">>(
						{ username },
						{ projection: { _id: 1 } }
					);
					if (!user) {
						error(404, `User "${username}" doesn't exist`);
					}
				}

				const settings = await collections.settings.findOne(authCondition(locals));

				if (!settings && activeOnly) {
					error(404, "No user settings found");
				}

				const queryTokens = !!search && generateQueryTokens(search);

				const filter: Filter<CommunityToolDB> = {
					...(!createdByCurrentUser &&
						!activeOnly &&
						!(locals.user?.isAdmin && showUnfeatured) && { review: ReviewStatus.APPROVED }),
					...(user && { createdById: user._id }),
					...(queryTokens && { searchTokens: { $all: queryTokens } }),
					...(activeOnly && {
						_id: {
							$in: (settings?.tools ?? []).map((key) => {
								return new ObjectId(key);
							}),
						},
					}),
				};

				const communityTools = await collections.tools
					.find(filter)
					.skip(NUM_PER_PAGE * pageIndex)
					.sort({
						...(sort === SortKey.TRENDING && { last24HoursUseCount: -1 }),
						useCount: -1,
					})
					.limit(NUM_PER_PAGE)
					.toArray();

				const configTools = toolFromConfigs
					.filter((tool) => !tool?.isHidden)
					.filter((tool) => {
						if (queryTokens) {
							return generateSearchTokens(tool.displayName).some((token) =>
								queryTokens.some((queryToken) => queryToken.test(token))
							);
						}
						return true;
					});

				const tools = [...(pageIndex == 0 && !username ? configTools : []), ...communityTools];

				const numTotalItems =
					(await collections.tools.countDocuments(filter)) + toolFromConfigs.length;

				return {
					tools: jsonSerialize(tools),
					numTotalItems,
					numItemsPerPage: NUM_PER_PAGE,
					query: search,
					sort,
					showUnfeatured,
				} satisfies GETToolsSearchResponse;
			},
			{
				query: t.Object({
					user: t.Optional(t.String()),
					q: t.Optional(t.String()),
					sort: t.Optional(t.Enum(SortKey)),
					p: t.Optional(t.Numeric()),
					showUnfeatured: t.Optional(t.Boolean()),
					active: t.Optional(t.Boolean()),
				}),
			}
		)
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
