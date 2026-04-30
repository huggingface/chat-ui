export enum ToolResultStatus {
	Success = "success",
	Error = "error",
}

export interface ToolCall {
	name: string;
	parameters: Record<string, string | number | boolean>;
	toolId?: string;
}

export interface ToolResultSuccess {
	status: ToolResultStatus.Success;
	call: ToolCall;
	outputs: Record<string, unknown>[];
	display?: boolean;
}

export interface ToolResultError {
	status: ToolResultStatus.Error;
	call: ToolCall;
	message: string;
	display?: boolean;
}

export type ToolResult = ToolResultSuccess | ToolResultError;

export interface ToolFront {
	_id: string;
	name: string;
	displayName?: string;
	description?: string;
	color?: string;
	icon?: string;
	type?: "config" | "community";
	isOnByDefault?: boolean;
	isLocked?: boolean;
	mimeTypes?: string[];
	timeToUseMS?: number;
}

// MCP Server types
export interface KeyValuePair {
	key: string;
	value: string;
}

export type ServerStatus = "connected" | "connecting" | "disconnected" | "error";

export interface MCPTool {
	name: string;
	description?: string;
	inputSchema?: unknown;
}

// OAuth tokens stored alongside an MCP custom server. Uses the same shape as
// the SDK's OAuthTokens response (RFC 6749), with an absolute `expires_at`
// computed from `expires_in` at issuance time so the client can decide when to
// refresh without trusting a relative-time field across page reloads.
export interface MCPOAuthTokens {
	access_token: string;
	token_type: string;
	refresh_token?: string;
	scope?: string;
	expires_at?: number;
	id_token?: string;
}

// Snapshot of the discovery + DCR results so we can refresh tokens or
// reconnect later without re-walking the WWW-Authenticate dance every time.
// Schemas mirror @modelcontextprotocol/sdk/shared/auth (RFC 8414, RFC 7591),
// kept loose here so we don't pull SDK Zod types into the public client bundle.
export interface MCPAuthorizationServerMetadata {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	registration_endpoint?: string;
	revocation_endpoint?: string;
	scopes_supported?: string[];
	code_challenge_methods_supported?: string[];
	grant_types_supported?: string[];
	token_endpoint_auth_methods_supported?: string[];
	[key: string]: unknown;
}

export interface MCPClientInformation {
	client_id: string;
	client_secret?: string;
	redirect_uris: string[];
	client_id_issued_at?: number;
	client_secret_expires_at?: number;
	[key: string]: unknown;
}

export interface MCPOAuthState {
	resource: string;
	asMetadata: MCPAuthorizationServerMetadata;
	resourceMetadataUrl?: string;
	clientInfo: MCPClientInformation;
	clientWasManuallyEntered?: boolean;
	tokens?: MCPOAuthTokens;
}

export interface MCPServer {
	id: string;
	name: string;
	url: string;
	type: "base" | "custom";
	headers?: KeyValuePair[];
	env?: KeyValuePair[];
	status?: ServerStatus;
	isLocked?: boolean;
	tools?: MCPTool[];
	errorMessage?: string;
	// Indicates server reports or appears to require OAuth or other auth
	authRequired?: boolean;
	// Populated once the server is recognized as OAuth-protected. `oauth.tokens`
	// being set means the server is authorized; absence means it still needs the
	// "Authorize" step.
	oauth?: MCPOAuthState;
}

export interface MCPServerApi {
	url: string;
	headers?: KeyValuePair[];
}
