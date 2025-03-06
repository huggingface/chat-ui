import { Elysia, t } from "elysia";
import { authPlugin } from "$api/authPlugin";
import { defaultModel } from "$lib/server/models";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { models, validateModel } from "$lib/server/models";
import { DEFAULT_SETTINGS, type SettingsEditable } from "$lib/types/Settings";
import { toolFromConfigs } from "$lib/server/tools";
import { ObjectId } from "mongodb";
import { z } from "zod";
import type { Assistant } from "$lib/types/Assistant";

export type UserGETFront = {
	id: string;
	username?: string;
	avatarUrl?: string;
	email?: string;
	logoutDisabled?: boolean;
	isAdmin: boolean;
	isEarlyAccess: boolean;
} | null;

export type UserGETSettings = {
	ethicsModalAccepted: boolean;
	ethicsModalAcceptedAt: Date | null;
	activeModel: string;
	hideEmojiOnSidebar: boolean;
	disableStream: boolean;
	directPaste: boolean;
	shareConversationsWithModelAuthors: boolean;
	customPrompts: Record<string, string>;
	assistants: string[];
	tools: string[];
};

export type UserGETAssistants = Array<
	Assistant & { _id: string; createdById: string; createdByMe: boolean }
>;

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
			.get("/", ({ locals }) => {
				return (
					locals.user
						? {
								id: locals.user._id.toString(),
								username: locals.user.username,
								avatarUrl: locals.user.avatarUrl,
								email: locals.user.email,
								logoutDisabled: locals.user.logoutDisabled,
								isAdmin: locals.user.isAdmin ?? false,
								isEarlyAccess: locals.user.isEarlyAccess ?? false,
							}
						: null
				) satisfies UserGETFront;
			})
			.get("/settings", async ({ locals }) => {
				const settings = await collections.settings.findOne(authCondition(locals));

				if (
					settings &&
					!validateModel(models).safeParse(settings?.activeModel).success &&
					!settings.assistants?.map((el) => el.toString())?.includes(settings?.activeModel)
				) {
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
					ethicsModalAccepted: !!settings?.ethicsModalAcceptedAt,
					ethicsModalAcceptedAt: settings?.ethicsModalAcceptedAt ?? null,

					activeModel: settings?.activeModel ?? DEFAULT_SETTINGS.activeModel,
					hideEmojiOnSidebar: settings?.hideEmojiOnSidebar ?? DEFAULT_SETTINGS.hideEmojiOnSidebar,
					disableStream: settings?.disableStream ?? DEFAULT_SETTINGS.disableStream,
					directPaste: settings?.directPaste ?? DEFAULT_SETTINGS.directPaste,
					shareConversationsWithModelAuthors:
						settings?.shareConversationsWithModelAuthors ??
						DEFAULT_SETTINGS.shareConversationsWithModelAuthors,

					customPrompts: settings?.customPrompts ?? {},
					assistants: settings?.assistants?.map((assistantId) => assistantId.toString()) ?? [],
					tools:
						settings?.tools ??
						toolFromConfigs
							.filter((el) => !el.isHidden && el.isOnByDefault)
							.map((el) => el._id.toString()),
				} satisfies UserGETSettings;
			})
			.post("/settings", async ({ locals, request }) => {
				const body = await request.json();

				const { ethicsModalAccepted, ...settings } = z
					.object({
						shareConversationsWithModelAuthors: z
							.boolean()
							.default(DEFAULT_SETTINGS.shareConversationsWithModelAuthors),
						hideEmojiOnSidebar: z.boolean().default(DEFAULT_SETTINGS.hideEmojiOnSidebar),
						ethicsModalAccepted: z.boolean().optional(),
						activeModel: z.string().default(DEFAULT_SETTINGS.activeModel),
						customPrompts: z.record(z.string()).default({}),
						tools: z.array(z.string()).optional(),
						disableStream: z.boolean().default(false),
						directPaste: z.boolean().default(false),
					})
					.parse(body) satisfies SettingsEditable;

				// make sure all tools exist
				// either in db or in config
				if (settings.tools) {
					const newTools = [
						...(await collections.tools
							.find({ _id: { $in: settings.tools.map((toolId) => new ObjectId(toolId)) } })
							.project({ _id: 1 })
							.toArray()
							.then((tools) => tools.map((tool) => tool._id.toString()))),
						...toolFromConfigs
							.filter((el) => (settings?.tools ?? []).includes(el._id.toString()))
							.map((el) => el._id.toString()),
					];

					settings.tools = newTools;
				}

				await collections.settings.updateOne(
					authCondition(locals),
					{
						$set: {
							...settings,
							...(ethicsModalAccepted && { ethicsModalAcceptedAt: new Date() }),
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
			.get("/assistant/active", async ({ locals }) => {
				const settings = await collections.settings.findOne(authCondition(locals));

				if (!settings) {
					return null;
				}

				if (settings.assistants?.map((el) => el.toString())?.includes(settings?.activeModel)) {
					return await collections.assistants.findOne({
						_id: new ObjectId(settings.activeModel),
					});
				}

				return null;
			})
			.get("/assistants", async ({ locals }) => {
				const settings = await collections.settings.findOne(authCondition(locals));

				if (!settings) {
					return [];
				}

				const userAssistants =
					settings?.assistants?.map((assistantId) => assistantId.toString()) ?? [];

				const assistants = await collections.assistants
					.find({
						_id: {
							$in: [...userAssistants.map((el) => new ObjectId(el))],
						},
					})
					.toArray();

				return assistants.map((el) => ({
					...el,
					_id: el._id.toString(),
					createdById: undefined,
					createdByMe:
						el.createdById.toString() === (locals.user?._id ?? locals.sessionId).toString(),
				}));
			})
			.get(
				"/foo",
				() => {
					return {
						name: "bar",
					};
				},
				{
					response: t.Object({
						name: t.String(),
					}),
				}
			);
	});
