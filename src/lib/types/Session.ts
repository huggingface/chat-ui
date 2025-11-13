import type { Timestamps } from "./Timestamps";
import type { User } from "./User";

export interface Session extends Timestamps {
	_id: string;
	sessionId: string;
	userId: User["_id"];
	userAgent?: string;
	ip?: string;
	expiresAt: Date;
	admin?: boolean;
	coupledCookieHash?: string;

	oauth?: {
		token: {
			value: string;
			expiresAt: Date;
		};
		refreshToken?: string;
	};
}
