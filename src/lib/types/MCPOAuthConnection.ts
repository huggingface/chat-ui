import type { ObjectId } from "mongodb";
import type { MCPAuthorizationServerMetadata, MCPClientInformation, MCPOAuthTokens } from "./Tool";
import type { Timestamps } from "./Timestamps";

export interface MCPOAuthAuthorizationFlow {
	id: string;
	expectedState: string;
	verifier: string;
	redirectUri: string;
	popupMode: boolean;
	redirectNext?: string;
	expiresAt: Date;
}

/**
 * Server-owned OAuth material for one MCP resource.
 *
 * This type must never be serialized to the browser. API responses use the
 * deliberately non-secret MCPOAuthState projection from Tool.ts instead.
 */
export interface MCPOAuthConnection extends Timestamps {
	_id: ObjectId;
	userId?: ObjectId;
	sessionId?: string;
	serverUrl: string;
	resource: string;
	resourceMetadataUrl?: string;
	asMetadata: MCPAuthorizationServerMetadata;
	clientInfo?: MCPClientInformation;
	clientWasManuallyEntered?: boolean;
	tokens?: MCPOAuthTokens;
	flow?: MCPOAuthAuthorizationFlow;
	status: "authorization_required" | "authorized";
	version: number;
	deleteAt?: Date;
}
