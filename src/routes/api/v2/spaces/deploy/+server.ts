import { error, type RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { createRepo, uploadFiles } from "@huggingface/hub";

import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { config } from "$lib/server/config";
import { buildDeployableHtml, isDeployableKind } from "$lib/utils/previewSrcdoc";
import { logger } from "$lib/server/logger";

const DEPLOYABLE_KINDS = ["html", "svg", "react", "mermaid"] as const;

const bodySchema = z.object({
	conversationId: z.string(),
	// Keep the identifier safe as a MongoDB dot-path key (no `.`/`$`).
	artifactIdentifier: z
		.string()
		.min(1)
		.max(256)
		.regex(/^[a-zA-Z0-9_-]+$/, "Invalid artifact identifier"),
	title: z.string().min(1).max(200),
	kind: z.enum(DEPLOYABLE_KINDS),
	content: z.string().min(1),
	visibility: z.enum(["public", "private"]).default("public"),
});

const SPACE_EMOJIS = ["🚀", "✨", "🎨", "🤗", "💡", "🧩", "🌈", "⚡️", "🪄", "🔮", "🛸", "🎯"];
const SPACE_COLORS = ["red", "yellow", "green", "blue", "indigo", "purple", "pink", "gray"];

function pick<T>(arr: readonly T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

function slugify(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.split("-")
		.filter(Boolean)
		.join("-")
		.slice(0, 80);
	return slug || "huggingchat-artifact";
}

function buildReadme(title: string): string {
	const safeTitle = title.replace(/"/g, "'").slice(0, 200);
	return `---
title: "${safeTitle}"
emoji: ${pick(SPACE_EMOJIS)}
colorFrom: ${pick(SPACE_COLORS)}
colorTo: ${pick(SPACE_COLORS)}
sdk: static
pinned: false
tags:
  - huggingchat
---

# ${safeTitle}

Built with [HuggingChat](https://huggingface.co/chat).
`;
}

function spaceUrl(repoId: string): string {
	return `https://huggingface.co/spaces/${repoId}`;
}

function statusCodeOf(err: unknown): number | undefined {
	if (err && typeof err === "object" && "statusCode" in err) {
		const code = (err as { statusCode?: unknown }).statusCode;
		return typeof code === "number" ? code : undefined;
	}
	return undefined;
}

/** 403 the client maps to a "grant Space permissions / sign in" prompt. */
function reauthResponse(): Response {
	return superjsonResponse(
		{
			code: "reauth-required",
			message: "Grant Hugging Face permission to create Spaces, then try again.",
		},
		{ status: 403 }
	);
}

export const POST: RequestHandler = async ({ locals, request }) => {
	requireAuth(locals);

	if (!config.isHuggingChat) {
		error(403, "Deploying artifacts to a Space is not enabled on this instance.");
	}

	const accessToken = locals.token;
	const username = locals.user?.username;
	if (!accessToken || !username) {
		// No HF OAuth token (e.g. anonymous session) — needs sign-in.
		return reauthResponse();
	}

	const body = bodySchema.parse(await request.json());

	if (!isDeployableKind(body.kind)) {
		error(400, "This artifact type cannot be deployed to a Space.");
	}

	if (!ObjectId.isValid(body.conversationId)) {
		error(400, "Invalid conversation ID");
	}

	const conversation = await collections.conversations.findOne({
		_id: new ObjectId(body.conversationId),
		...authCondition(locals),
	});
	if (!conversation) {
		error(404, "Conversation not found");
	}

	const files = [
		{
			path: "index.html",
			content: new Blob([buildDeployableHtml(body.kind, body.content)], { type: "text/html" }),
		},
		{
			path: "README.md",
			content: new Blob([buildReadme(body.title)], { type: "text/markdown" }),
		},
	];

	const existing = conversation.deployedSpaces?.[body.artifactIdentifier];

	// Re-deploy: push a new commit to the Space we created earlier.
	if (existing) {
		try {
			await uploadFiles({
				repo: { type: "space", name: existing.repoId },
				accessToken,
				files,
				commitTitle: "Update from HuggingChat",
			});
			return superjsonResponse({
				repoId: existing.repoId,
				url: spaceUrl(existing.repoId),
				created: false,
			});
		} catch (err) {
			const status = statusCodeOf(err);
			if (status === 401 || status === 403) {
				return reauthResponse();
			}
			// 404 → the Space was deleted on the Hub; recreate it below.
			if (status !== 404) {
				logger.error(err, "Failed to update deployed Space");
				error(502, "Failed to update the Space. Please try again.");
			}
		}
	}

	// First deploy (or recreate): make a fresh Space, retrying on name collisions.
	// Preserve the original visibility when recreating a deleted Space — the update
	// modal hides the visibility toggle, so body.visibility is the "public" default
	// and would otherwise flip a previously-private Space to public.
	const isPrivate = existing?.private ?? body.visibility === "private";
	const baseSlug = slugify(body.title);
	let repoId: string | undefined;
	for (let attempt = 0; attempt < 4 && !repoId; attempt++) {
		const slug = attempt === 0 ? baseSlug : `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;
		const candidate = `${username}/${slug}`;
		try {
			await createRepo({
				repo: { type: "space", name: candidate },
				accessToken,
				sdk: "static",
				private: isPrivate,
			});
			repoId = candidate;
		} catch (err) {
			const status = statusCodeOf(err);
			if (status === 401 || status === 403) {
				return reauthResponse();
			}
			// 409 → name already taken; loop tries a suffixed slug.
			if (status !== 409) {
				logger.error(err, "Failed to create Space");
				error(502, "Failed to create the Space. Please try again.");
			}
		}
	}
	if (!repoId) {
		error(409, "Could not find an available Space name. Try renaming the artifact.");
	}

	// Persist the mapping right after creation so a failed upload still self-heals
	// into an update on the next deploy instead of orphaning the Space.
	await collections.conversations.updateOne(
		{ _id: conversation._id, ...authCondition(locals) },
		{
			$set: {
				[`deployedSpaces.${body.artifactIdentifier}`]: {
					repoId,
					createdAt: new Date(),
					private: isPrivate,
				},
			},
		}
	);

	try {
		await uploadFiles({
			repo: { type: "space", name: repoId },
			accessToken,
			files,
			commitTitle: "Deploy from HuggingChat",
		});
	} catch (err) {
		const status = statusCodeOf(err);
		if (status === 401 || status === 403) {
			return reauthResponse();
		}
		logger.error(err, "Failed to upload files to Space");
		error(502, "The Space was created but uploading files failed. Try deploying again.");
	}

	return superjsonResponse({ repoId, url: spaceUrl(repoId), created: true });
};
