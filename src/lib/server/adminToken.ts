import { config } from "$lib/server/config";
import type { Session } from "$lib/types/Session";
import { logger } from "./logger";
import { v4 } from "uuid";
import { timingSafeEqual } from "crypto";

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
	if (typeof a !== "string" || typeof b !== "string") {
		return false;
	}
	const maxLength = Math.max(a.length, b.length);
	const paddedA = a.padEnd(maxLength, "\0");
	const paddedB = b.padEnd(maxLength, "\0");
	try {
		return timingSafeEqual(Buffer.from(paddedA), Buffer.from(paddedB)) && a.length === b.length;
	} catch {
		return false;
	}
}

class AdminTokenManager {
	private token = config.ADMIN_TOKEN || v4();
	// contains all session ids that are currently admin sessions
	private adminSessions: Array<Session["sessionId"]> = [];

	public get enabled() {
		// if open id is configured, disable the feature
		return config.ADMIN_CLI_LOGIN === "true";
	}
	public isAdmin(sessionId: Session["sessionId"]) {
		if (!this.enabled) return false;
		return this.adminSessions.includes(sessionId);
	}

	public checkToken(token: string, sessionId: Session["sessionId"]) {
		if (!this.enabled) return false;
		// Use timing-safe comparison to prevent timing attacks
		if (safeCompare(token, this.token)) {
			logger.info(`[ADMIN] Token validated`);
			this.adminSessions.push(sessionId);
			this.token = config.ADMIN_TOKEN || v4();
			return true;
		}

		return false;
	}

	public removeSession(sessionId: Session["sessionId"]) {
		this.adminSessions = this.adminSessions.filter((id) => id !== sessionId);
	}

	public displayToken() {
		// if admin token is set, don't display it
		if (!this.enabled || config.ADMIN_TOKEN) return;

		let port = process.env.PORT
			? parseInt(process.env.PORT)
			: process.argv.includes("--port")
				? parseInt(process.argv[process.argv.indexOf("--port") + 1])
				: undefined;

		if (!port) {
			const mode = process.argv.find((arg) => arg === "preview" || arg === "dev");
			if (mode === "preview") {
				port = 4173;
			} else if (mode === "dev") {
				port = 5173;
			} else {
				port = 3000;
			}
		}

		const url = (config.PUBLIC_ORIGIN || `http://localhost:${port}`) + "?token=";
		logger.info(`[ADMIN] You can login with ${url + this.token}`);
	}
}

export const adminTokenManager = new AdminTokenManager();
