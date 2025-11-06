import type { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js'

// Internal type for storing OAuth state in localStorage during the popup flow.
export interface StoredState {
  expiry: number
  metadata?: OAuthMetadata
  serverUrlHash: string
  providerOptions: {
    serverUrl: string
    storageKeyPrefix: string
    clientName: string
    clientUri: string
    callbackUrl: string
  }
}

