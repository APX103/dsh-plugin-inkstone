/**
 * SCP Hub library surface for 端砚: the directory client, the API-key
 * exchange, deployment endpoints, and local persistence shapes.
 *
 * @module dsh-plugin-inkstone/scphub
 */

export { ScpHubError, type ScpHubErrorCode } from './error'
export { ScpHubApiKey, automaticApiKeyName, shanghaiTimestampMs, type ScpHubApiKeyGrant, type ScpHubApiKeyOptions, type ScpHubCredentialStore, type ScpHubEnvironment } from './credential'
export { ScpHubClient, type ScpHubCatalogItem, type ScpHubCatalogPage, type ScpHubScpDetail, type ScpHubSkillDetail, type ScpHubToolSummary, type ScpHubClientOptions } from './client'
export { SCP_HUB_DEPLOYMENTS, ScpHubService, type ScpHubServiceConfig } from './service'
export type { LocalScp, LocalSkill } from './types'
