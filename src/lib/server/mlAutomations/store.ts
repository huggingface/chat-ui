import { createHash, randomBytes } from "node:crypto";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { collections } from "$lib/server/database";
import { assertBillableOrganization } from "$lib/server/billingOrganizations";
import type { MlAutomation } from "$lib/types/MlAutomation";
import type { User } from "$lib/types/User";
import { sealToken } from "./identity";

export const automationInput = z
	.object({
		name: z.string().trim().min(1).max(100),
		instruction: z.string().trim().min(1).max(4_000),
		budgetUsd: z.number().finite().positive().max(1_000),
		maxRunsPerDay: z.number().int().min(1).max(100).default(10),
		billTo: z
			.object({
				organization: z.string().trim().min(1),
				resourceGroup: z.string().trim().min(1).optional(),
			})
			.optional(),
		token: z.string().trim().min(1),
	})
	.strict();

export type AutomationInput = z.input<typeof automationInput>;

export type AutomationView = Omit<MlAutomation, "token" | "secretHash">;

export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

const toView = ({
	token: _token,
	secretHash: _secretHash,
	...view
}: MlAutomation): AutomationView => view;

const whoami = z.object({ id: z.string().min(1), auth: z.object({ type: z.string() }) });

/** a token of another account would run as them while the owner pays */
async function assertOwnToken(token: string, user: User): Promise<void> {
	const response = await fetch("https://huggingface.co/api/whoami-v2", {
		headers: { Authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(15_000),
	});
	if (response.status === 401) error(400, "The Hub did not accept this token.");
	if (!response.ok) error(502, "Could not check this token with Hugging Face.");
	const account = whoami.safeParse(await response.json());
	if (!account.success || account.data.auth.type !== "access_token")
		error(400, "Use a user access token from your Hugging Face settings.");
	if (account.data.id !== user.hfUserId) error(400, "This token belongs to another account.");
}

/** the secret is returned once, only its hash is stored */
export async function createAutomation(
	locals: Pick<App.Locals, "user" | "token">,
	input: AutomationInput
): Promise<{ automation: AutomationView; secret: string }> {
	const user = locals.user;
	if (!user) error(401, "Sign in to add an automation.");
	const parsed = automationInput.parse(input);
	await assertOwnToken(parsed.token, user);
	// checked with the browser sign in, the owner proves they may bill it as themselves
	if (parsed.billTo)
		await assertBillableOrganization(
			locals,
			parsed.billTo.organization,
			parsed.billTo.resourceGroup
		);
	const secret = randomBytes(32).toString("base64url");
	const now = new Date();
	const automation: MlAutomation = {
		_id: new ObjectId(),
		userId: user._id,
		name: parsed.name,
		instruction: parsed.instruction,
		budgetUsd: parsed.budgetUsd,
		maxRunsPerDay: parsed.maxRunsPerDay,
		...(parsed.billTo ? { billTo: parsed.billTo } : {}),
		token: sealToken(parsed.token),
		secretHash: hashSecret(secret),
		enabled: true,
		createdAt: now,
		updatedAt: now,
	};
	await collections.mlAutomations.insertOne(automation);
	return { automation: toView(automation), secret };
}

export async function listAutomations(userId: ObjectId): Promise<AutomationView[]> {
	const rows = await collections.mlAutomations
		.find({ userId })
		.sort({ createdAt: -1 })
		.limit(100)
		.toArray();
	return rows.map(toView);
}

export async function setAutomationEnabled(
	userId: ObjectId,
	id: ObjectId,
	enabled: boolean
): Promise<boolean> {
	const result = await collections.mlAutomations.updateOne(
		{ _id: id, userId },
		{
			$set: { enabled, updatedAt: new Date() },
			...(enabled ? { $unset: { disabledReason: "" } } : {}),
		}
	);
	return result.matchedCount > 0;
}

/** runs already going stop at their next resume, which can no longer find the token */
export async function deleteAutomation(userId: ObjectId, id: ObjectId): Promise<boolean> {
	const result = await collections.mlAutomations.deleteOne({ _id: id, userId });
	return result.deletedCount > 0;
}
