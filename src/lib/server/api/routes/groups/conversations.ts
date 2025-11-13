import { Elysia, error, t } from "elysia";
import { authPlugin } from "$api/authPlugin";

export const conversationGroup = new Elysia().use(authPlugin).group("/conversations", (app) => {
	return (
		app
			.guard({
				as: "scoped",
				beforeHandle: async ({ locals }) => {
					if (!locals.user?._id && !locals.sessionId) {
						return error(401, "Must have a valid session or user");
					}
				},
			})
			.get(
				"",
				async ({ query: _query }) => {
					// Conversations are now stored client-side
					// Return empty array - client loads from IndexedDB
					return { conversations: [], nConversations: 0 };
				},
				{
					query: t.Object({
						p: t.Optional(t.Number()),
					}),
				}
			)
			.delete("", async () => {
				// Conversation deletion is handled client-side
				return 0;
			})
			// Conversations are now stored client-side
			// All endpoints return empty/not implemented responses
			.group(
				"/:id",
				{
					params: t.Object({
						id: t.String(),
					}),
				},
				(app) => {
					return app
						.get("", () => {
							// Conversations are loaded client-side from IndexedDB
							throw new Error("Conversation not found - use client-side storage");
						})
						.post("", () => {
							throw new Error("Not implemented - use POST /conversation/[id]");
						})
						.delete("", () => {
							// Conversation deletion is handled client-side
							return { success: true };
						})
						.get("/output/:sha256", () => {
							throw new Error("Not implemented - files are stored client-side");
						})
						.post("/share", () => {
							throw new Error("Not implemented - sharing is not supported");
						})
						.post("/stop-generating", () => {
							throw new Error("Not implemented - use POST /conversation/[id]/stop-generating");
						})
						.patch("", () => {
							// Conversation updates are handled client-side
							return { success: true };
						})
						.delete("/message/:messageId", () => {
							// Message deletion is handled client-side
							return { success: true };
						});
				}
			)
	);
});
