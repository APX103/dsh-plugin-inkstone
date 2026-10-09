/**
 * SCP Hub library surface for 端砚: the directory client, the API-key
 * exchange, deployment endpoints, and local persistence shapes.
 *
 * @module dsh-plugin-inkstone/scphub
 */
export { ScpHubError } from './error';
export { ScpHubApiKey, automaticApiKeyName, shanghaiTimestampMs } from './credential';
export { ScpHubClient } from './client';
export { SCP_HUB_DEPLOYMENTS, ScpHubService } from './service';
