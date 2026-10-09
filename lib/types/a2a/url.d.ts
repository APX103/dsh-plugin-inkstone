/**
 * A2A endpoint URL validation. Remote agents are called over HTTPS in
 * production; plain HTTP is reserved for literal loopback addresses in local
 * tests, mirroring the registry integration guides.
 *
 * @module dsh-plugin-inkstone/a2a/url
 */
/**
 * Validate one A2A data-plane endpoint URL.
 * @param raw - the endpoint URL exactly as discovery returned it.
 * @returns the parsed URL.
 * @throws A2aError (`endpoint`) on a non-URL, credentials, query, fragment, or a non-HTTPS scheme outside literal loopback hosts.
 */
export declare function assertA2aEndpointUrl(raw: string): URL;
