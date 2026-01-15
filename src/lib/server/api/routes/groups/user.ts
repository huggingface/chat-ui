import { Elysia } from "elysia";
import { authPlugin } from "$api/authPlugin";
import { defaultModel } from "$lib/server/models";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { models, validateModel } from "$lib/server/models";
import { DEFAULT_SETTINGS, type SettingsEditable } from "$lib/types/Settings";
import { z } from "zod";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";

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
					toolsOverrides: settings?.toolsOverrides ?? {},
					billingOrganization: settings?.billingOrganization ?? undefined,
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
						toolsOverrides: z.record(z.boolean()).default({}),
						disableStream: z.boolean().default(false),
						directPaste: z.boolean().default(false),
						hidePromptExamples: z.record(z.boolean()).default({}),
						billingOrganization: z.string().optional(),
					})
					.parse(body) satisfies SettingsEditable;

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
			})
			.get("/billing-orgs", async ({ locals, set }) => {
				// Only available for HuggingChat
				if (!config.isHuggingChat) {
					set.status = 404;
					return { error: "Not available" };
				}

				// Requires authenticated user with OAuth token
				if (!locals.user) {
					set.status = 401;
					return { error: "Login required" };
				}

				if (!locals.token) {
					set.status = 401;
					return { error: "OAuth token not available. Please log out and log back in." };
				}

				try {
					// Fetch billing info from HuggingFace OAuth userinfo
					const response = await fetch("https://huggingface.co/oauth/userinfo", {
						headers: { Authorization: `Bearer ${locals.token}` },
					});

					if (!response.ok) {
						logger.error(`Failed to fetch billing orgs: ${response.status}`);
						set.status = 502;
						return { error: "Failed to fetch billing information" };
					}

					const data = await response.json();

					// Get user's current billingOrganization setting
					const settings = await collections.settings.findOne(authCondition(locals));
					const currentBillingOrg = settings?.billingOrganization;

					// Filter orgs to only those with canPay: true
					const billingOrgs = (data.orgs ?? [])
						.filter((org: { canPay?: boolean }) => org.canPay === true)
						.map((org: { sub: string; name: string; preferred_username: string }) => ({
							sub: org.sub,
							name: org.name,
							preferred_username: org.preferred_username,
						}));

					// Check if current billing org is still valid
					const isCurrentOrgValid =
						!currentBillingOrg ||
						billingOrgs.some(
							(org: { preferred_username: string }) => org.preferred_username === currentBillingOrg
						);

					// If current billing org is no longer valid, clear it
					if (!isCurrentOrgValid && currentBillingOrg) {
						logger.info(
							`Clearing invalid billingOrganization '${currentBillingOrg}' for user ${locals.user._id}`
						);
						await collections.settings.updateOne(authCondition(locals), {
							$unset: { billingOrganization: "" },
							$set: { updatedAt: new Date() },
						});
					}

					return {
						userCanPay: data.canPay ?? false,
						organizations: billingOrgs,
						currentBillingOrg: isCurrentOrgValid ? currentBillingOrg : undefined,
					};
				} catch (err) {
					logger.error(err, "Error fetching billing orgs:");
					set.status = 500;
					return { error: "Internal server error" };
				}
			});
	});
