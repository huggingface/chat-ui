import type { Handle } from '@sveltejs/kit';
import { addYears } from 'date-fns';

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get('session');

	event.locals.sessionId = token || crypto.randomUUID();

	// Setting a cookie breaks /api/conversation, maybe due to the proxy
	if (!event.url.pathname.startsWith('/api')) {
		// Refresh cookie expiration date
		event.cookies.set('session', event.locals.sessionId, {
			path: '/',
			sameSite: 'lax',
			secure: true,
			httpOnly: true,
			expires: addYears(new Date(), 1)
		});
	}

	const response = await resolve(event);

	return response;
};
