import { randomUUID } from "crypto";
import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import type { ElicitationField, ElicitationRequestPayload } from "$lib/types/McpElicitation";
import type {
	MlReview,
	PublishAudience,
	PublishDecision,
	ReviewDestination,
} from "$lib/types/MlReview";
import {
	MessageElicitationUpdateType,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { ownerToken } from "./destination";
import { readReview } from "./store";

const HUB_URL = "https://huggingface.co";
const LOOKUP_TIMEOUT_MS = 5_000;
const WRITE_ROLES = new Set(["admin", "write", "contributor"]);

/** the select on the publish card, its value is the decision */
export const PUBLISH_FIELD = "publish";

interface Lookup {
	token?: string;
	fetch?: typeof fetch;
}

async function getJson(url: string, { token, fetch: f = fetch }: Lookup) {
	const res = await f(url, {
		headers: token ? { Authorization: `Bearer ${token}` } : {},
		signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
	});
	return {
		status: res.status,
		body: res.ok ? ((await res.json()) as Record<string, unknown>) : {},
	};
}

/** a lookup that fails reads as writable, the push still falls back to a pull request on a 403 */
export async function resolveAudience(
	destination: ReviewDestination,
	lookup: Lookup
): Promise<PublishAudience> {
	const kind = destination.type === "bucket" ? "buckets" : "datasets";
	let exists = false;
	let isPrivate: boolean | undefined;
	let canWrite = Boolean(lookup.token);
	try {
		const repo = await getJson(`${HUB_URL}/api/${kind}/${destination.repo}`, lookup);
		if (repo.status === 200) {
			exists = true;
			isPrivate = repo.body.private === true || repo.body.visibility === "private";
		} else if (repo.status === 401 || repo.status === 403) {
			exists = true;
			isPrivate = true;
		}
	} catch (err) {
		logger.warn({ err, repo: destination.repo }, "[review] could not look up the destination");
	}
	if (lookup.token) {
		try {
			const who = await getJson(`${HUB_URL}/api/whoami-v2`, lookup);
			const name = typeof who.body.name === "string" ? who.body.name : undefined;
			const role = (who.body.auth as { accessToken?: { role?: string } } | undefined)?.accessToken
				?.role;
			const namespace = destination.repo.split("/")[0];
			const orgs = Array.isArray(who.body.orgs) ? (who.body.orgs as Record<string, unknown>[]) : [];
			if (who.status !== 200 || role === "read") canWrite = false;
			else if (namespace !== name) {
				const org = orgs.find((o) => o.name === namespace);
				canWrite = !!org && WRITE_ROLES.has(String(org.roleInOrg));
			}
		} catch (err) {
			logger.warn({ err }, "[review] could not look up the signed in user");
		}
	}
	return {
		label: audienceLabel(destination, { exists, isPrivate, canWrite }),
		exists,
		...(isPrivate !== undefined ? { private: isPrivate } : {}),
		canWrite,
	};
}

function audienceLabel(
	destination: ReviewDestination,
	{ exists, isPrivate, canWrite }: { exists: boolean; isPrivate?: boolean; canWrite: boolean }
): string {
	const visibility = isPrivate ? "private" : "public";
	if (destination.type === "bucket") {
		return exists
			? `existing ${visibility} bucket ${destination.repo}`
			: `new private bucket ${destination.repo}`;
	}
	if (!canWrite || destination.pr) {
		return `pull request on ${exists ? `${visibility} ` : ""}dataset ${destination.repo}`;
	}
	return exists
		? `existing ${visibility} dataset ${destination.repo}`
		: `new private dataset ${destination.repo}`;
}

export function publishOptions(
	destination: ReviewDestination,
	audience: PublishAudience
): Extract<ElicitationField, { kind: "select" }>["options"] {
	const where = `${destination.path}, ${audience.label}`;
	return [
		...(audience.canWrite && !destination.pr
			? [{ value: "push", label: `Push to ${audience.label}`, description: destination.path }]
			: []),
		...(destination.type === "dataset"
			? [
					{
						value: "pr",
						label: `Open a pull request on ${destination.repo}`,
						description: where,
					},
				]
			: []),
		{ value: "skip", label: "Don't push", description: "Keep the labels in this chat only" },
	];
}

/** the first decision stands, a skip moves the destination aside so nothing pushes it later */
export async function decidePublish(
	review: MlReview,
	decision: PublishDecision,
	reason?: string
): Promise<MlReview> {
	const now = new Date();
	const skipped = decision === "skip";
	const updated = await collections.mlReviews.findOneAndUpdate(
		{ _id: review._id, "publish.decision": { $exists: false } },
		{
			$set: {
				"publish.decision": decision,
				"publish.decidedAt": now,
				...(reason ? { "publish.reason": reason } : {}),
				...(skipped && review.destination ? { declinedDestination: review.destination } : {}),
				updatedAt: now,
			},
			...(skipped ? { $unset: { destination: "" } } : {}),
		},
		{ returnDocument: "after" }
	);
	return (
		updated.value ?? (await readReview(review.conversationId, review._id.toString())) ?? review
	);
}

export type OpenedPublish =
	| { update: MessageUpdate; elicitationId: string }
	/** nothing to choose, the review was decided as a skip */
	| { decided: MlReview };

/** one card per review, a repeat resume finds the one it opened and nowhere to push is a skip */
export async function openPublishPrompt({
	review,
	messageId,
	toolCallId,
	toolUuid,
	generationId,
	deliver,
	lookup,
}: {
	review: MlReview;
	messageId: string;
	toolCallId: string;
	toolUuid: string;
	generationId?: string;
	deliver?: boolean;
	lookup?: Lookup;
}): Promise<OpenedPublish> {
	const destination = review.destination;
	if (!destination) return { decided: review };
	const token = lookup?.token ?? (await ownerToken(review.conversationId));
	const audience = await resolveAudience(destination, { ...lookup, token });
	const options = publishOptions(destination, audience);
	if (options.length === 1) {
		return {
			decided: await decidePublish(
				review,
				"skip",
				`the signed in user cannot write to ${destination.repo}`
			),
		};
	}

	const elicitationId = randomUUID();
	const now = new Date();
	const taken = await collections.mlReviews.updateOne(
		{ _id: review._id, "publish.promptId": { $exists: false } },
		{ $set: { "publish.promptId": elicitationId, "publish.audience": audience, updatedAt: now } }
	);
	if (taken.matchedCount === 0) {
		const current = await readReview(review.conversationId, review._id.toString());
		const open = current?.publish?.promptId
			? await collections.mcpElicitations.findOne({ elicitationId: current.publish.promptId })
			: null;
		if (open?.status === "pending") {
			return {
				update: {
					type: MessageUpdateType.Elicitation,
					subtype: MessageElicitationUpdateType.Request,
					request: open.request,
					toolUuid,
				},
				elicitationId: open.elicitationId,
			};
		}
		return { decided: current ?? review };
	}

	const question = `Push the labels of review "${review.schema.title}" to ${audience.label}?`;
	const request: ElicitationRequestPayload = {
		elicitationId,
		source: "assistant",
		server: "",
		mode: "form",
		reviewId: review._id.toString(),
		message: question,
		fields: [
			{
				kind: "select",
				name: PUBLISH_FIELD,
				title: "Labels",
				// the ask panel shows a field description as the question, never the message
				description: question,
				required: true,
				multiple: false,
				options,
			},
		],
	};
	await collections.mcpElicitations.insertOne({
		_id: new ObjectId(),
		elicitationId,
		conversationId: review.conversationId,
		...(generationId ? { generationId } : {}),
		status: "pending",
		request,
		pending: {
			kind: "ask",
			messageId,
			toolCallId,
			toolUuid,
			publish: {
				reviewId: review._id.toString(),
				destination,
				audience,
				...(deliver ? { deliver: true as const } : {}),
			},
		},
		createdAt: now,
		updatedAt: now,
	});
	return {
		update: {
			type: MessageUpdateType.Elicitation,
			subtype: MessageElicitationUpdateType.Request,
			request,
			toolUuid,
		},
		elicitationId,
	};
}

/** anything but an accepted push or pr is a skip */
export function chosenDecision(
	action: string | undefined,
	content: Record<string, unknown> | undefined
): PublishDecision {
	const value = action === "accept" ? content?.[PUBLISH_FIELD] : undefined;
	return value === "push" || value === "pr" ? value : "skip";
}
