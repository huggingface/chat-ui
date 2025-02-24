import { Elysia } from "elysia";
import { authPlugin } from "$lib/server/api/authPlugin";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { authCondition } from "$lib/server/auth";
import { jsonSerialize } from "$lib/utils/serialize";

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
					return jsonSerialize(assistant);
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
