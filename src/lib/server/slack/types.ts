import type { ObjectId } from "mongodb";

export interface SlackThread {
	_id: string;
	teamId: string;
	channel: string;
	threadTs: string;
	owner: string;
	watching: boolean;
	pollAt?: Date;
	conversationId: ObjectId;
	createdAt: Date;
	updatedAt: Date;
}

export interface SlackInput {
	_id: string;
	threadId: string;
	user: string;
	text: string;
	resumeElicitationId?: string;
	retry?: boolean;
	expectedMessageId?: string;
	expectedGenerationId?: string;
	ts: string;
	status: "queued" | "running" | "done" | "failed";
	createdAt: Date;
	updatedAt: Date;
	/** An interrupted dispatch is never automatically submitted a second time. */
	error?: string;
	failureNotified?: boolean;
}

export interface SlackDelivery {
	/** Public progress retained independently of the changing status card. */
	publicText?: string;
	publicSnapshot?: string;
	questionId?: string;
	questionSnapshot?: string;
	statusClosed?: boolean;
	questionFinalized?: boolean;
	_id: string;
	threadId: string;
	messageId: string;
	parts: string[];
	digest?: string;
	updatedAt: Date;
}

export interface SlackLease {
	_id: string;
	owner: string;
	until: Date;
}
