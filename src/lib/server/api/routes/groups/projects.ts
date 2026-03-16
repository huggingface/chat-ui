import { Elysia, status, t } from "elysia";
import { authPlugin } from "$api/authPlugin";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { authCondition } from "$lib/server/auth";
import { validModelIdSchema } from "$lib/server/models";
import { extractText } from "$lib/server/projectKnowledge/extractText";
import { embedFileChunks } from "$lib/server/projectKnowledge/embedFile";
import { isTeiAvailable } from "$lib/server/projectKnowledge/embed";
import { logger } from "$lib/server/logger";

const MAX_PROJECTS_PER_USER = 50;
const MAX_FILES_PER_PROJECT = 20;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const projectGroup = new Elysia().use(authPlugin).group("/projects", (app) => {
	return app
		.guard({
			as: "scoped",
			beforeHandle: async ({ locals }) => {
				if (!locals.user?._id && !locals.sessionId) {
					return status(401, { message: "Must have a valid session or user" });
				}
			},
		})
		.get("", async ({ locals }) => {
			const projects = await collections.projects
				.find(authCondition(locals))
				.sort({ updatedAt: -1 })
				.toArray();

			// Count conversations per project
			const projectIds = projects.map((p) => p._id);
			const counts = await collections.conversations
				.aggregate<{ _id: ObjectId; count: number }>([
					{
						$match: {
							...authCondition(locals),
							projectId: { $in: projectIds },
						},
					},
					{ $group: { _id: "$projectId", count: { $sum: 1 } } },
				])
				.toArray();

			const countMap = new Map(counts.map((c) => [c._id.toString(), c.count]));

			return {
				projects: projects.map((p) => ({
					_id: p._id,
					name: p.name,
					description: p.description,
					preprompt: p.preprompt,
					modelId: p.modelId,
					updatedAt: p.updatedAt,
					conversationCount: countMap.get(p._id.toString()) ?? 0,
				})),
			};
		})
		.post(
			"",
			async ({ locals, body }) => {
				const count = await collections.projects.countDocuments(authCondition(locals));
				if (count >= MAX_PROJECTS_PER_USER) {
					return status(429, {
						message: `You can have at most ${MAX_PROJECTS_PER_USER} projects.`,
					});
				}

				if (body.modelId && !validModelIdSchema.safeParse(body.modelId).success) {
					return status(400, { message: "Invalid model ID" });
				}

				const now = new Date();
				const res = await collections.projects.insertOne({
					_id: new ObjectId(),
					name: body.name,
					...(body.description && { description: body.description }),
					...(body.preprompt && { preprompt: body.preprompt }),
					...(body.modelId && { modelId: body.modelId }),
					createdAt: now,
					updatedAt: now,
					...(locals.user ? { userId: locals.user._id } : { sessionId: locals.sessionId }),
				});

				return {
					project: {
						_id: res.insertedId,
						name: body.name,
						description: body.description,
						preprompt: body.preprompt,
						modelId: body.modelId,
						updatedAt: now,
						conversationCount: 0,
					},
				};
			},
			{
				body: t.Object({
					name: t.String({ minLength: 1, maxLength: 100 }),
					description: t.Optional(t.String({ maxLength: 500 })),
					preprompt: t.Optional(t.String({ maxLength: 10000 })),
					modelId: t.Optional(t.String()),
				}),
			}
		)
		.group(
			"/:id",
			{
				params: t.Object({
					id: t.String(),
				}),
			},
			(app) => {
				return (
					app
						.derive(async ({ locals, params }) => {
							try {
								new ObjectId(params.id);
							} catch {
								throw new Error("Invalid project ID format");
							}

							const project = await collections.projects.findOne({
								_id: new ObjectId(params.id),
								...authCondition(locals),
							});

							if (!project) {
								throw new Error("Project not found");
							}

							return { project };
						})
						.get("", async ({ project }) => {
							return {
								_id: project._id,
								name: project.name,
								description: project.description,
								preprompt: project.preprompt,
								modelId: project.modelId,
								updatedAt: project.updatedAt,
							};
						})
						.patch(
							"",
							async ({ locals, params, body }) => {
								if (body.modelId && !validModelIdSchema.safeParse(body.modelId).success) {
									throw new Error("Invalid model ID");
								}

								const updateValues = {
									...(body.name !== undefined && { name: body.name }),
									...(body.description !== undefined && { description: body.description }),
									...(body.preprompt !== undefined && { preprompt: body.preprompt }),
									...(body.modelId !== undefined && { modelId: body.modelId }),
									updatedAt: new Date(),
								};

								const res = await collections.projects.updateOne(
									{
										_id: new ObjectId(params.id),
										...authCondition(locals),
									},
									{ $set: updateValues }
								);

								if (res.matchedCount === 0) {
									throw new Error("Project not found");
								}

								return { success: true };
							},
							{
								body: t.Object({
									name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
									description: t.Optional(t.String({ maxLength: 500 })),
									preprompt: t.Optional(t.String({ maxLength: 10000 })),
									modelId: t.Optional(t.String()),
								}),
							}
						)
						.delete("", async ({ locals, params }) => {
							const projectId = new ObjectId(params.id);

							// Ungroup all conversations in this project
							await collections.conversations.updateMany(
								{
									projectId,
									...authCondition(locals),
								},
								{ $unset: { projectId: "" } }
							);

							// Clean up knowledge files + chunks
							const knowledgeFiles = await collections.projectKnowledgeFiles
								.find({ projectId })
								.project({ gridfsFileId: 1 })
								.toArray();

							for (const f of knowledgeFiles) {
								await collections.bucket.delete(f.gridfsFileId).catch((e) => {
									logger.error({ gridfsFileId: f.gridfsFileId, e }, "Failed to delete GridFS file");
								});
							}

							await collections.projectKnowledgeChunks.deleteMany({ projectId });
							await collections.projectKnowledgeFiles.deleteMany({ projectId });

							const res = await collections.projects.deleteOne({
								_id: projectId,
								...authCondition(locals),
							});

							if (res.deletedCount === 0) {
								throw new Error("Project not found");
							}

							return { success: true };
						})
						// Knowledge file routes
						.get("/files", async ({ project }) => {
							const files = await collections.projectKnowledgeFiles
								.find({ projectId: project._id })
								.sort({ createdAt: -1 })
								.project({
									_id: 1,
									name: 1,
									mime: 1,
									sizeBytes: 1,
									charCount: 1,
									chunkCount: 1,
									embeddingStatus: 1,
									createdAt: 1,
								})
								.toArray();

							return { files };
						})
						.post(
							"/files",
							async ({ project, body }) => {
								const fileCount = await collections.projectKnowledgeFiles.countDocuments({
									projectId: project._id,
								});
								if (fileCount >= MAX_FILES_PER_PROJECT) {
									return status(429, {
										message: `A project can have at most ${MAX_FILES_PER_PROJECT} files.`,
									});
								}

								const file = body.file;
								const buffer = Buffer.from(await file.arrayBuffer());

								if (buffer.length > MAX_FILE_SIZE) {
									return status(400, { message: "File exceeds 10 MB limit" });
								}

								// Extract text synchronously
								const text = await extractText(buffer, file.type, file.name);

								// Store in GridFS
								const gridfsUpload = collections.bucket.openUploadStream(
									`project-${project._id}-${file.name}`,
									{ metadata: { projectId: project._id.toString(), mime: file.type } }
								);
								gridfsUpload.write(buffer as unknown as Buffer);
								gridfsUpload.end();

								const gridfsFileId: ObjectId = await new Promise((resolve, reject) => {
									gridfsUpload.once("finish", () => resolve(gridfsUpload.id as ObjectId));
									gridfsUpload.once("error", reject);
									setTimeout(() => reject(new Error("GridFS upload timed out")), 20_000);
								});

								const now = new Date();
								const doc = {
									_id: new ObjectId(),
									projectId: project._id,
									name: file.name,
									mime: file.type,
									sizeBytes: buffer.length,
									gridfsFileId,
									extractedText: text,
									charCount: text.length,
									chunkCount: 0,
									embeddingStatus: "pending" as const,
									createdAt: now,
									updatedAt: now,
								};

								await collections.projectKnowledgeFiles.insertOne(doc);

								// Kick off async embedding if TEI is available
								if (isTeiAvailable() && text.length > 0) {
									embedFileChunks(doc._id).catch((err) => {
										logger.error({ fileId: doc._id, err }, "Async embedding failed");
									});
								}

								return {
									file: {
										_id: doc._id,
										name: doc.name,
										mime: doc.mime,
										sizeBytes: doc.sizeBytes,
										charCount: doc.charCount,
										chunkCount: doc.chunkCount,
										embeddingStatus: doc.embeddingStatus,
										createdAt: doc.createdAt,
									},
								};
							},
							{
								body: t.Object({
									file: t.File(),
								}),
							}
						)
						.delete(
							"/files/:fileId",
							async ({ project, params: { fileId: fileIdStr } }) => {
								let fileId: ObjectId;
								try {
									fileId = new ObjectId(fileIdStr);
								} catch {
									return status(400, { message: "Invalid file ID" });
								}

								const file = await collections.projectKnowledgeFiles.findOne({
									_id: fileId,
									projectId: project._id,
								});

								if (!file) {
									return status(404, { message: "File not found" });
								}

								// Delete GridFS file
								await collections.bucket.delete(file.gridfsFileId).catch((e) => {
									logger.error(
										{ gridfsFileId: file.gridfsFileId, e },
										"Failed to delete GridFS file"
									);
								});

								// Delete chunks + file doc
								await collections.projectKnowledgeChunks.deleteMany({ fileId });
								await collections.projectKnowledgeFiles.deleteOne({ _id: fileId });

								return { success: true };
							},
							{
								params: t.Object({
									id: t.String(),
									fileId: t.String(),
								}),
							}
						)
				);
			}
		);
});
