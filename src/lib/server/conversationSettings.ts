import type { Filter, UpdateResult } from "mongodb";
import { collections } from "$lib/server/database";
import type { Conversation } from "$lib/types/Conversation";

/** The mutable conversation settings both PATCH endpoints expose. */
export interface ConversationSettingsUpdate {
	title?: string;
	model?: string;
}

/**
 * Apply a title/model change, backfilling producer metadata when the pinned
 * model changes.
 *
 * Shared rather than duplicated because getting this wrong is silent: switching
 * the model means every prior assistant message was produced by the OLD model,
 * and those messages carry no `routerMetadata.model` of their own — it is only
 * ever stamped for the "omni" router alias. Without the backfill, history
 * replay's same-producer check treats them as produced by the newly selected
 * model and attaches the old model's reasoning to a turn it never produced. An
 * endpoint that changes `model` with a plain `$set` reintroduces exactly that,
 * which is what happened while only the legacy handler had the pipeline.
 *
 * Runs as an aggregation pipeline so the backfill is computed server-side from
 * the document as it exists at write time: mapping a snapshot read earlier in
 * the request and writing it back would replace the whole array, discarding
 * anything persisted in between — an in-flight generation rewrites the same
 * array on every token batch. `$model` is likewise the currently pinned model
 * rather than one read earlier, so the id stamped is always the one messages
 * were actually produced under, and the `$ne` gate means a switch that raced
 * ahead leaves history untouched instead of restamping it.
 *
 * Callers own authorization: pass a filter that already scopes to the caller.
 */
export function applyConversationSettings(
	filter: Filter<Conversation>,
	values: ConversationSettingsUpdate
): Promise<UpdateResult> {
	const updateValues = {
		// Titles are model-generated, so they can carry think markup.
		...(values.title !== undefined && {
			title: values.title.replace(/<\/?think>/gi, "").trim(),
		}),
		...(values.model !== undefined && { model: values.model }),
	};

	if (values.model === undefined) {
		return collections.conversations.updateOne(filter, { $set: updateValues });
	}

	const newModel = values.model;
	return collections.conversations.updateOne(filter, [
		{
			$set: {
				messages: {
					$cond: [
						{ $ne: ["$model", newModel] },
						{
							$map: {
								input: "$messages",
								as: "m",
								in: {
									$cond: [
										{
											$and: [
												{ $eq: ["$$m.from", "assistant"] },
												// No producer of its own — see the note above.
												{ $eq: [{ $ifNull: ["$$m.routerMetadata.model", ""] }, ""] },
											],
										},
										{
											$mergeObjects: [
												"$$m",
												{
													// Merged rather than replaced so an existing `route` or
													// `provider` survives; `route` is required by the type,
													// hence the default underneath.
													routerMetadata: {
														$mergeObjects: [
															{ route: "" },
															{ $ifNull: ["$$m.routerMetadata", {}] },
															{ model: "$model" },
														],
													},
												},
											],
										},
										"$$m",
									],
								},
							},
						},
						"$messages",
					],
				},
			},
		},
		// Separate stage: within one `$set` every expression sees the input
		// document, so the backfill above must resolve `$model` before this
		// overwrites it.
		{ $set: updateValues },
	]);
}
