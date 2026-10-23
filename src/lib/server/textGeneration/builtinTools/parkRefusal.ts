/** names the call that parked first, blaming the wrong call gets it retried in the same round */

const ASK = "ask_user_question";
const REVIEW = "request_review";

export function askParkRefusal(parkedBy: string): string {
	return parkedBy === ASK
		? `Only one ${ASK} call can be answered per turn. Put every question in a single call's \`questions\` array.`
		: `This question was not shown: ${parkedBy} already paused this turn, and only one call can. Ask it after the turn resumes, if it still matters.`;
}

export function reviewParkRefusal(parkedBy: string): string {
	return parkedBy === REVIEW
		? `Only one ${REVIEW} can wait on the user per turn. Put the records in one batch, or show the next batch once this one is submitted.`
		: `This review was not shown: ${parkedBy} already paused this turn, and only one call can. Call ${REVIEW} again after the turn resumes.`;
}

export function waitParkRefusal(parkedBy: string): string {
	return parkedBy === "wait"
		? "Only one call can park per round. Wait for one thing at a time, then check the rest when you wake."
		: `This wait did not start: ${parkedBy} already paused this turn, and only one call can. Wait again after the turn resumes, if you still need to.`;
}
