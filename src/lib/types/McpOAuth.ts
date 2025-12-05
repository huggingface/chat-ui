/**
 * MCP OAuth 2.1 Type Definitions
 * Following the MCP Authorization spec
 */

/**
 * OAuth server metadata from .well-known/oauth-authorization-server
 * Per RFC 8414 (OAuth 2.0 Authorization Server Metadata)
 */
export interface OAuthServerMetadata {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	registration_endpoint?: string; // For Dynamic Client Registration (RFC 7591)
	scopes_supported?: string[];
	response_types_supported?: string[];
	code_challenge_methods_supported?: string[]; // Should include "S256" for PKCE
	token_endpoint_auth_methods_supported?: string[];
	grant_types_supported?: string[];
}

/**
 * PKCE state for in-progress OAuth flows
 */
export interface PKCEState {
	codeVerifier: string;
	codeChallenge: string;
	state: string; // CSRF protection
}

/**
 * Stored OAuth token data per MCP server
 */
export interface McpOAuthToken {
	accessToken: string;
	refreshToken?: string;
	expiresAt: number; // Unix timestamp in milliseconds
	tokenType: string; // Usually "Bearer"
	scope?: string;
}

/**
 * OAuth configuration stored per server
 */
export interface McpOAuthConfig {
	serverId: string;
	serverUrl: string;
	clientId: string;
	metadata: OAuthServerMetadata;
}

/**
 * OAuth flow state (persisted during active auth flow to survive redirects)
 */
export interface McpOAuthFlowState {
	serverId: string;
	serverUrl: string;
	serverName: string;
	pkce: PKCEState;
	metadata: OAuthServerMetadata;
	clientId: string;
	startedAt: number; // Unix timestamp for flow timeout
	returnTo?: string; // URL to return to after OAuth
}

/**
 * Result of OAuth discovery check
 */
export interface OAuthDiscoveryResult {
	required: boolean;
	metadata?: OAuthServerMetadata;
	error?: string;
}

/**
 * Token exchange response from OAuth token endpoint
 */
export interface TokenResponse {
	access_token: string;
	token_type: string;
	expires_in?: number;
	refresh_token?: string;
	scope?: string;
}

/**
 * Dynamic Client Registration response (RFC 7591)
 */
export interface ClientRegistrationResponse {
	client_id: string;
	client_secret?: string;
	client_id_issued_at?: number;
	client_secret_expires_at?: number;
}
