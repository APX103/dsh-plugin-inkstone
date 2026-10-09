/**
 * Registry client library for 端砚: OpenXLab SSO, the STS ticket exchange,
 * and the MCP-served A2A agent directory.
 *
 * @module dsh-plugin-inkstone/registry
 */
export { RegistryError } from './error';
export { OPENXLAB_DEFAULT_BASE_URL, OpenXLabSso, parseExpiry, unwrapEnvelope } from './sso';
export { STS_PATH, StsExchange, extractStsData, jwtExpSeconds, stsHeaders, stsTtlMs, } from './sts';
export { MCP_PATH, RegistryDirectory, parseAgentEntries, toolResultText } from './discovery';
export { A2aRegistryService, RegistryClientCore } from './service';
