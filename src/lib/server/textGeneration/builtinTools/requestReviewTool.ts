import { randomUUID } from "crypto";
import { BSON, ObjectId } from "mongodb";
import type { Conversation } from "$lib/types/Conversation";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import { isHfMcpServer } from "$lib/server/mcp/hf";
import { readMlFile } from "$lib/server/mlFiles";
import { turnAwaitingInput } from "$lib/server/generation/turnState";
import { createReview } from "$lib/server/mlReviews/store";
import { loadRecords, parseFileSource, parseRecordsInput } from "$lib/server/mlReviews/source";
import { loadTable, type TableInput } from "$lib/server/mlReviews/tableSource";
import { parseDestination } from "$lib/server/mlReviews/destination";
import { resolveAudience, resolveSourceAudience } from "$lib/server/mlReviews/publish";
import { reviewSlug } from "$lib/server/mlReviews/result";
import { recordsFromTabular } from "$lib/server/mlReviews/tabular";
import type { ElicitationRequestPayload } from "$lib/types/McpElicitation";
import type { ReviewDestination, ReviewRecord, ReviewSource } from "$lib/types/MlReview";
import { MessageReviewUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { parseReviewSchema } from "$lib/utils/review/schema";
import { compileRecordValidator } from "$lib/utils/review/records";
import { reviewSchemaHash } from "$lib/utils/review/hash";
import {
	REQUEST_REVIEW_PREPROMPT,
	REVIEW_MAX_BYTES,
	REQUEST_REVIEW_TOOL_NAME,
	requestReviewDefinition,
} from "./requestReviewDefinition";
import type { NestedAgentBuiltinTool, NestedAgentDeps } from "./nestedAgent";
import { reviewParkRefusal } from "./parkRefusal";
import type { BuiltinToolContext, BuiltinToolResult } from "./types";

export { REQUEST_REVIEW_TOOL_NAME };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const describeSource = (source: ReviewSource): string =>
	source.kind === "file"
		? `${source.name} v${source.version}`
		: source.kind === "sandbox"
			? `${source.handle}:${source.path}`
			: source.kind === "hub" || source.kind === "parquet"
				? source.uri
				: source.kind === "dataset"
					? source.repo
					: "source.records";

const isTableInput = (input: object): input is TableInput =>
	"dataset" in input || "parquet" in input;

const refuse = (problem: string): BuiltinToolResult => ({
	error: `${REQUEST_REVIEW_TOOL_NAME} was not shown: ${problem}`,
});

async function declaration(
	conversationId: ObjectId,
	args: Record<string, unknown>
): Promise<{ value: Record<string, unknown> } | { error: string }> {
	const inline = {
		title: args.title,
		instructions: args.instructions,
		id_field: args.id_field,
		suggestions: args.suggestions,
	};
	if (args.schema === undefined) {
		return { value: { ...inline, fields: args.fields, questions: args.questions } };
	}
	if (args.fields !== undefined || args.questions !== undefined) {
		return { error: "pass schema or inline fields and questions, not both" };
	}
	if (typeof args.schema !== "string" || !args.schema.trim()) {
		return { error: "schema must be a virtual file name" };
	}
	const { name, version } = parseFileSource(args.schema.trim());
	const file = await readMlFile(conversationId, name, version);
	if (!file) {
		return {
			error: `no virtual file "${name}"; write the {fields, questions} JSON with write_file first, or declare them inline`,
		};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(file.content);
	} catch {
		return { error: `schema file ${file.name} v${file.version} is not valid JSON` };
	}
	if (!isRecord(parsed)) {
		return { error: `schema file ${file.name} must hold a {fields, questions} object` };
	}
	return {
		value: {
			...inline,
			id_field: inline.id_field ?? parsed.id_field,
			suggestions: inline.suggestions ?? parsed.suggestions,
			fields: parsed.fields,
			questions: parsed.questions,
		},
	};
}

async function requestReview(
	conv: Pick<Conversation, "_id">,
	args: Record<string, unknown>,
	ctx: BuiltinToolContext,
	deps: NestedAgentDeps | undefined,
	token: () => string | undefined
): Promise<BuiltinToolResult> {
	// the sink, not messageId, a sub agent run has a messageId and no pane
	const sink = ctx.elicitationSink;
	if (!sink || !ctx.messageId) return refuse("there is no chat to show the review in");

	const declared = await declaration(conv._id, args);
	if ("error" in declared) return refuse(declared.error);
	const input = parseRecordsInput(args.source);
	if ("error" in input) return refuse(input.error);
	const table = isTableInput(input) ? input : undefined;

	let destination: ReviewDestination | undefined;
	if (args.destination !== undefined && args.destination !== null) {
		const title = typeof declared.value.title === "string" ? declared.value.title : "review";
		const parsed = parseDestination(args.destination, `data/${reviewSlug(title)}.parquet`);
		if ("error" in parsed) return refuse(parsed.error);
		destination = parsed;
	}

	// a table source may leave the fields to the dataset column types
	let schema =
		!table || declared.value.fields !== undefined ? parseReviewSchema(declared.value) : undefined;
	if (schema && !schema.ok) return refuse(schema.error);

	let records: ReviewRecord[];
	let source: ReviewSource;
	let mediaLinks: Record<string, string>[] | undefined;
	if (table) {
		const idField = declared.value.id_field;
		const loaded = await loadTable(table, {
			...(schema?.ok ? { fields: schema.schema.fields } : {}),
			...(typeof idField === "string" && idField.trim() ? { idField: idField.trim() } : {}),
			access: { token: token(), signal: ctx.abortSignal },
		});
		if (!loaded.ok) return refuse(ctx.abortSignal?.aborted ? "Aborted by user" : loaded.error);
		if (!schema) schema = parseReviewSchema({ ...declared.value, fields: loaded.fields });
		if (!schema.ok) return refuse(schema.error);
		const validated = compileRecordValidator(schema.schema)(loaded.records);
		if (!validated.ok) {
			return refuse(
				`the rows do not match the declared fields. Fix these and call again:\n${validated.errors.join("\n")}`
			);
		}
		records = validated.records.map((record, i) => ({
			...record,
			origin: loaded.origins[i],
			...(loaded.media.length ? { media: loaded.media } : {}),
		}));
		source = loaded.source;
		mediaLinks = loaded.mediaLinks;
	} else {
		if (!schema?.ok) return refuse("the fields could not be read");
		if (isTableInput(input)) return refuse("the source could not be read");
		const loaded = await loadRecords(input, {
			conversationId: conv._id,
			hubServer: deps?.servers.find((server) => isHfMcpServer(server.url)),
			signal: ctx.abortSignal,
		});
		if (!loaded.ok) return refuse(loaded.error);
		const tabular = loaded.table
			? recordsFromTabular(schema.schema, loaded.table, describeSource(loaded.source))
			: undefined;
		if (tabular && "error" in tabular) return refuse(tabular.error);
		const validated = compileRecordValidator(schema.schema)(tabular?.records ?? loaded.records);
		if (!validated.ok) {
			return refuse(
				`the records do not match the declared fields. Fix these and call again:\n${validated.errors.join("\n")}`
			);
		}
		records = validated.records;
		source = loaded.source;
	}

	// the row also holds up to 8 MiB of drafts, so the records are measured as stored, not as read
	const storedBytes = BSON.calculateObjectSize({ records });
	if (storedBytes > REVIEW_MAX_BYTES) {
		return refuse(
			`the records take ${(storedBytes / 1024 / 1024).toFixed(1)} MB once stored; a review holds at most ${
				REVIEW_MAX_BYTES / 1024 / 1024
			} MB. Split them into batches on the same schema`
		);
	}

	const elicitationId = randomUUID();
	const review = await createReview({
		conversationId: conv._id,
		messageId: ctx.messageId,
		toolCallId: ctx.toolCallId,
		toolUuid: ctx.uuid,
		elicitationId,
		schema: schema.schema,
		schemaHash: await reviewSchemaHash(schema.schema),
		source,
		records,
		...(mediaLinks ? { mediaLinks } : {}),
		...(destination
			? {
					destination,
					// shown on the finish step, the publish card looks the destination up again when it opens
					publish: await Promise.all([
						resolveAudience(destination, { token: token() }),
						resolveSourceAudience(source, { token: token() }),
					]).then(([audience, sourceAudience]) => ({ audience, source: sourceAudience })),
				}
			: {}),
	});
	const reviewId = review._id.toString();

	// never emitted, the pane reads the review row and the generic answer endpoint refuses it
	const request: ElicitationRequestPayload = {
		elicitationId,
		source: "assistant",
		server: "",
		mode: "form",
		message: schema.schema.title,
	};
	const now = new Date();
	try {
		await collections.mcpElicitations.insertOne({
			_id: new ObjectId(),
			elicitationId,
			conversationId: conv._id,
			...(sink.generationId ? { generationId: sink.generationId } : {}),
			status: "pending",
			request,
			pending: {
				kind: "review",
				reviewId,
				messageId: ctx.messageId,
				toolCallId: ctx.toolCallId,
				toolUuid: ctx.uuid,
			},
			createdAt: now,
			updatedAt: now,
		});
	} catch (err) {
		logger.error({ err }, "[review] failed to record the pending review");
		await collections.mlReviews.deleteOne({ _id: review._id }).catch(() => undefined);
		return refuse("it could not be recorded");
	}

	sink.emit({
		type: MessageUpdateType.Review,
		subtype: MessageReviewUpdateType.Request,
		reviewId,
		toolUuid: ctx.uuid,
		title: schema.schema.title,
		records: records.length,
		questions: schema.schema.questions.length,
		mode: schema.schema.questions.some((question) => question.required) ? "label" : "review",
	});
	if (ctx.conversationId) {
		const stateUpdate = await turnAwaitingInput({
			conversationId: ctx.conversationId,
			messageId: ctx.messageId,
			producerId: ctx.generationId ?? "",
			...(ctx.userId ? { userId: ctx.userId } : {}),
			...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
		});
		sink.emit(stateUpdate);
	}
	return { awaitingInput: true };
}

/** bound like import_file, the hub server that reads a sandbox or hf:// source is per turn */
export function createRequestReviewTool(
	conv: Pick<Conversation, "_id">,
	/** the user hub token, a dataset or parquet source is read with it */
	token: () => string | undefined = () => undefined
): NestedAgentBuiltinTool {
	let deps: NestedAgentDeps | undefined;
	return {
		name: REQUEST_REVIEW_TOOL_NAME,
		definition: requestReviewDefinition,
		preprompt: REQUEST_REVIEW_PREPROMPT,
		exemptFromToolRestraint: true,
		mayPark: true,
		parkRefusalMessage: reviewParkRefusal,
		bind(next: NestedAgentDeps) {
			deps = next;
		},
		execute: (args, ctx) => requestReview(conv, args, ctx, deps, token),
	};
}
