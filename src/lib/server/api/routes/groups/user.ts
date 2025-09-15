import { Elysia } from "elysia";
import { authPlugin } from "$api/authPlugin";
import { defaultModel } from "$lib/server/models";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { models, validateModel } from "$lib/server/models";
import { DEFAULT_SETTINGS, type SettingsEditable } from "$lib/types/Settings";
import { z } from "zod";

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
							logoutDisabled: locals.user.logoutDisabled,
							isAdmin: locals.user.isAdmin ?? false,
							isEarlyAccess: locals.user.isEarlyAccess ?? false,
						}
					: null;
			})
			.get("/settings", async ({ locals }) => {
				const settings = await collections.settings.findOne(authCondition(locals));

				if (settings && !validateModel(models).safeParse(settings?.activeModel).success) {
					settings.activeModel = defaultModel.id;
					await collections.settings.updateOne(authCondition(locals), {
						$set: { activeModel: defaultModel.id },
					});
				}

				// if the model is unlisted, set the active model to the default model
				if (
					settings?.activeModel &&
					models.find((m) => m.id === settings?.activeModel)?.unlisted === true
				) {
					settings.activeModel = defaultModel.id;
					await collections.settings.updateOne(authCondition(locals), {
						$set: { activeModel: defaultModel.id },
					});
				}

				// todo: get user settings
				return {
					welcomeModalSeen: !!settings?.welcomeModalSeenAt,
					welcomeModalSeenAt: settings?.welcomeModalSeenAt ?? null,

					activeModel: settings?.activeModel ?? DEFAULT_SETTINGS.activeModel,
					disableStream: settings?.disableStream ?? DEFAULT_SETTINGS.disableStream,
					directPaste: settings?.directPaste ?? DEFAULT_SETTINGS.directPaste,
					hidePromptExamples: settings?.hidePromptExamples ?? DEFAULT_SETTINGS.hidePromptExamples,
					shareConversationsWithModelAuthors:
						settings?.shareConversationsWithModelAuthors ??
						DEFAULT_SETTINGS.shareConversationsWithModelAuthors,

					customPrompts: settings?.customPrompts ?? {},
					multimodalOverrides: settings?.multimodalOverrides ?? {},
				};
			})
			.post("/settings", async ({ locals, request }) => {
				const body = await request.json();

				const { welcomeModalSeen, ...settings } = z
					.object({
						shareConversationsWithModelAuthors: z
							.boolean()
							.default(DEFAULT_SETTINGS.shareConversationsWithModelAuthors),
						welcomeModalSeen: z.boolean().optional(),
						activeModel: z.string().default(DEFAULT_SETTINGS.activeModel),
						customPrompts: z.record(z.string()).default({}),
						multimodalOverrides: z.record(z.boolean()).default({}),
						disableStream: z.boolean().default(false),
						directPaste: z.boolean().default(false),
						hidePromptExamples: z.record(z.boolean()).default({}),
					})
					.parse(body) satisfies SettingsEditable;

				// Tools removed: ignore tools updates

				await collections.settings.updateOne(
					authCondition(locals),
					{
						$set: {
							...settings,
							...(welcomeModalSeen && { welcomeModalSeenAt: new Date() }),
							updatedAt: new Date(),
						},
						$setOnInsert: {
							createdAt: new Date(),
						},
					},
					{
						upsert: true,
					}
				);
				// return ok response
				return new Response();
			})
			.get("/reports", async ({ locals }) => {
				if (!locals.user || !locals.sessionId) {
					return [];
				}

				const reports = await collections.reports
					.find({
						createdBy: locals.user?._id ?? locals.sessionId,
					})
					.toArray();
				return reports;
			});
	});
