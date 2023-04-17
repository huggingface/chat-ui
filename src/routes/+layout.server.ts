import * as jose from 'jose';
import type { LayoutServerLoad } from './$types';
import { AUTH_SECRET } from '$env/static/private';

const DEFAULT_MAX_AGE = 30 * 24 * 60 * 60; // 30 days
const now = () => (Date.now() / 1000) | 0;

export const load = (async ({ cookies }) => {
	const encryptionSecret = jose.base64url.decode(AUTH_SECRET);

	let jwt = cookies.get('session');

	// If there is no session cookie, create one
	if (!jwt) {
		// Create a new encrypted JWT with jose
		// TODO: migrate this to something like Auth.js when we have a proper signin process https://github.com/nextauthjs/next-auth/blob/main/packages/core/src/jwt.ts#L50
		jwt = await new jose.EncryptJWT({ id: crypto.randomUUID() })
			.setProtectedHeader({ alg: 'dir', enc: 'A128CBC-HS256' })
			.setIssuedAt()
			.setExpirationTime(now() + DEFAULT_MAX_AGE)
			.setJti(crypto.randomUUID())
			.encrypt(encryptionSecret);

		cookies.set('session', jwt);
	}

	const { payload } = await jose.jwtDecrypt(jwt, encryptionSecret, {
		clockTolerance: 15
	});

	return {
		session: payload
	};
}) satisfies LayoutServerLoad;
