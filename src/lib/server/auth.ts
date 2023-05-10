import { HF_CLIENT_ID, HF_CLIENT_SECRET } from "$env/static/private";

export const requiresUser = !!HF_CLIENT_ID && !!HF_CLIENT_SECRET;

export const authCondition = (locals: App.Locals) => {
	return locals.userId
		? { userId: locals.userId }
		: { sessionId: locals.sessionId, userId: { $exists: false } };
};
