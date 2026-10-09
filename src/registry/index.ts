/**
 * Registry client library for 端砚: OpenXLab SSO, the STS ticket exchange,
 * and the MCP-served A2A agent directory.
 *
 * @module dsh-plugin-inkstone/registry
 */

export { RegistryError, type RegistryErrorCode } from './error'
export { OPENXLAB_DEFAULT_BASE_URL, OpenXLabSso, parseExpiry, unwrapEnvelope, type OpenXLabSsoOptions, type SsoTokenState } from './sso'
export {
  STS_PATH,
  StsExchange,
  extractStsData,
  jwtExpSeconds,
  stsHeaders,
  stsTtlMs,
  type RegistryAuthScheme,
  type StsExchangeOptions,
} from './sts'
export { MCP_PATH, RegistryDirectory, parseAgentEntries, toolResultText, type RegistryAgentEntry, type RegistryDirectoryOptions } from './discovery'
export { A2aRegistryService, RegistryClientCore, type RegistryCredentialStore, type RegistryLoginState, type RegistryServiceConfig } from './service'
