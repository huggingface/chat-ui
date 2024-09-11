import { logout } from "$lib/server/auth";

export const actions = {
	async default({ cookies, locals }) {
		await logout(cookies, locals);
	},
};
