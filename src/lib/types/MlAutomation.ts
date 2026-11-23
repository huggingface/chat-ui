import type { ObjectId } from "mongodb";
import type { Timestamps } from "./Timestamps";
import type { User } from "./User";

export interface MlBillTo {
	organization: string;
	resourceGroup?: string;
}

/** a hub webhook that starts a headless ml intern run on each delivery */
export interface MlAutomation extends Timestamps {
	_id: ObjectId;
	userId: User["_id"];
	name: string;
	instruction: string;
	/** ceiling for each run, nobody can raise it */
	budgetUsd: number;
	maxRunsPerDay: number;
	/** absent bills the owner */
	billTo?: MlBillTo;
	/** the owner's hub token, sealed with the session oauth key */
	token: string;
	/** sha256 of the X-Webhook-Secret the hub sends */
	secretHash: string;
	enabled: boolean;
	/** why the receiver turned it off, cleared when the owner turns it back on */
	disabledReason?: string;
}

export type MlAutomationDeliveryStatus = "started" | "skipped" | "failed";

/** one hub delivery keyed by automation and Webhook-Id, which a retry reuses */
export interface MlAutomationDelivery {
	_id: string;
	automationId: ObjectId;
	userId: User["_id"];
	receivedAt: Date;
	status: MlAutomationDeliveryStatus;
	conversationId?: ObjectId;
	reason?: string;
	event: { action: string; scope: string; repo: string };
}
