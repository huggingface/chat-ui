import type { ObjectId } from "mongodb";
import type { MlBudget } from "$lib/types/Conversation";
import type {
	ElicitationRequestPayload,
	ElicitationValue,
	PendingKind,
} from "$lib/types/McpElicitation";
import type { Message } from "$lib/types/Message";
import type { PlanState } from "$lib/types/Plan";
import type { TurnState } from "$lib/types/TurnState";
import type { TurnLiveness } from "$lib/server/generation/turnLog";

export type RunId = ObjectId;

/** a run and the account it must belong to, every command and read checks the pair */
export interface RunRef {
	conversationId: RunId;
	ownerId: ObjectId;
}

export interface RunQuestion {
	elicitationId: string;
	generationId?: string;
	kind?: PendingKind;
	/** the assistant message the question parked */
	messageId?: string;
	request: ElicitationRequestPayload;
	content?: Record<string, ElicitationValue>;
	/** option per field, staged before the answer is submitted */
	choices?: Record<string, number>;
	choiceRevision?: number;
}

export type RunMessage = Pick<
	Message,
	| "id"
	| "from"
	| "content"
	| "updates"
	| "generationId"
	| "interrupted"
	| "createdAt"
	| "queuedContinuationOf"
>;

export type RunTurn =
	| { kind: "superseded"; message: RunMessage }
	| {
			kind: "turn";
			message: RunMessage;
			state: Pick<TurnState, "status" | "createdAt" | "updatedAt">;
			live: TurnLiveness;
			/** the question this turn is waiting on */
			question?: RunQuestion;
			/** the newest answered question of this turn a client asked to echo */
			sharedAnswer?: RunQuestion;
			/** a continued turn starts when the turn it continues started */
			startedAt: Date;
	  };

export interface RunStatus {
	messageId: string;
	/** the turn a status card belongs to, steering may drain into a new assistant message */
	cardMessageId: string;
	budget?: MlBudget;
	plan: PlanState | null;
}

export interface TurnInput {
	text?: string;
	files?: File[];
	resumeElicitationId?: string;
	retry?: boolean;
}
