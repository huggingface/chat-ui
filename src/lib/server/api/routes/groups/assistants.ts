import { Elysia, t } from "elysia";
import { authPlugin } from "$api/authPlugin";
import { collections } from "$lib/server/database";
import { ObjectId, type Filter } from "mongodb";
import { authCondition } from "$lib/server/auth";
import { SortKey, type Assistant } from "$lib/types/Assistant";
import { env } from "$env/dynamic/private";
import type { User } from "$lib/types/User";
import { ReviewStatus } from "$lib/types/Review";
import { generateQueryTokens } from "$lib/utils/searchTokens";
import { jsonSerialize, type Serialize } from "$lib/utils/serialize";

export type GETAssistantsSearchResponse = {
	assistants: Array<Serialize<Assistant>>;
	selectedModel: string;
	numTotalItems: number;
	numItemsPerPage: number;
	query: string | null;
	sort: SortKey;
	showUnfeatured: boolean;
};

const NUM_PER_PAGE = 24;

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
		.get(
			"/search",
			async ({ query, locals, error }) => {
				if (!env.ENABLE_ASSISTANTS) {
					error(403, "Assistants are not enabled");
				}
				const modelId = query.modelId;
				const pageIndex = query.p ?? 0;
				const username = query.user;
				const search = query.q?.trim() ?? null;
				const sort = query.sort ?? SortKey.TRENDING;
				const showUnfeatured = query.showUnfeatured ?? false;
				const createdByCurrentUser = locals.user?.username && locals.user.username === username;

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
				// if we require featured assistants, that we are not on a user page and we are not an admin who wants to see unfeatured assistants, we show featured assistants
				let shouldBeFeatured = {};

				if (
					env.REQUIRE_FEATURED_ASSISTANTS === "true" &&
					!(locals.user?.isAdmin && showUnfeatured)
				) {
					if (!user) {
						// only show featured assistants on the community page
						shouldBeFeatured = { review: ReviewStatus.APPROVED };
					} else if (!createdByCurrentUser) {
						// on a user page show assistants that have been approved or are pending
						shouldBeFeatured = { review: { $in: [ReviewStatus.APPROVED, ReviewStatus.PENDING] } };
					}
				}

				const noSpecificSearch = !user && !search;
				// fetch the top assistants sorted by user count from biggest to smallest.
				// filter by model too if modelId is provided or query if query is provided
				// only show assistants that have been used by more than 5 users if no specific search is made
				const filter: Filter<Assistant> = {
					...(modelId && { modelId }),
					...(user && { createdById: user._id }),
					...(search && { searchTokens: { $all: generateQueryTokens(search) } }),
					...(noSpecificSearch && { userCount: { $gte: 5 } }),
					...shouldBeFeatured,
				};

				const assistants = await collections.assistants
					.find(filter)
					.sort({
						...(sort === SortKey.TRENDING && { last24HoursCount: -1 }),
						userCount: -1,
						_id: 1,
					})
					.skip(NUM_PER_PAGE * pageIndex)
					.limit(NUM_PER_PAGE)
					.toArray();

				const numTotalItems = await collections.assistants.countDocuments(filter);

				return {
					assistants: jsonSerialize(assistants),
					selectedModel: modelId ?? "",
					numTotalItems,
					numItemsPerPage: NUM_PER_PAGE,
					query: search,
					sort,
					showUnfeatured,
				};
			},
			{
				query: t.Object({
					user: t.Optional(t.String()),
					q: t.Optional(t.String()),
					sort: t.Optional(t.Enum(SortKey)),
					p: t.Optional(t.Numeric()),
					showUnfeatured: t.Optional(t.Boolean()),
					modelId: t.Optional(t.String()),
				}),
			}
		)
		.group("/:id", (app) => {
			return app
				.derive(async ({ params, error }) => {
					const assistant = await collections.assistants.findOne({
						_id: new ObjectId(params.id),
					});

					if (!assistant) {
						return error(404, "Assistant not found");
					}

					return { assistant };
				})
				.get("", ({ assistant }) => {
					return assistant;
				})
				.patch("", () => {
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
				.post("/subscribe", async ({ locals, assistant }) => {
					const result = await collections.settings.updateOne(authCondition(locals), {
						$addToSet: { assistants: assistant._id },
						$set: { activeModel: assistant._id.toString() },
					});

					if (result.modifiedCount > 0) {
						await collections.assistants.updateOne(
							{ _id: assistant._id },
							{ $inc: { userCount: 1 } }
						);
					}

					return { message: "Assistant subscribed" };
				})
				.delete("/subscribe", async ({ locals, assistant }) => {
					const result = await collections.settings.updateOne(authCondition(locals), {
						$pull: { assistants: assistant._id },
					});

					if (result.modifiedCount > 0) {
						await collections.assistants.updateOne(
							{ _id: assistant._id },
							{ $inc: { userCount: -1 } }
						);
					}

					return { message: "Assistant unsubscribed" };
				});
		});
});
