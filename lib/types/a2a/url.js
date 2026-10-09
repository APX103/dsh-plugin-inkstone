/**
 * A2A endpoint URL validation. Remote agents are called over HTTPS in
 * production; plain HTTP is reserved for literal loopback addresses in local
 * tests, mirroring the registry integration guides.
 *
 * @module dsh-plugin-inkstone/a2a/url
 */
import { isIP } from 'node:net';
import { A2aError } from './error';
/**
 * Validate one A2A data-plane endpoint URL.
 * @param raw - the endpoint URL exactly as discovery returned it.
 * @returns the parsed URL.
 * @throws A2aError (`endpoint`) on a non-URL, credentials, query, fragment, or a non-HTTPS scheme outside literal loopback hosts.
 */
export function assertA2aEndpointUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new A2aError('endpoint', `invalid A2A endpoint URL: ${raw}`);
    }
    if (url.username !== '' || url.password !== '') {
        throw new A2aError('endpoint', 'A2A endpoint URL must not carry credentials');
    }
    if (url.search !== '' || url.hash !== '') {
        throw new A2aError('endpoint', 'A2A endpoint URL must not carry a query or fragment');
    }
    const host = url.hostname;
    const bareHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
    const loopback = url.protocol === 'http:' && isIP(bareHost) !== 0 && (bareHost === '127.0.0.1' || bareHost === '::1');
    if (url.protocol !== 'https:' && !loopback) {
        throw new A2aError('endpoint', `A2A endpoint URL must be HTTPS (or loopback HTTP): ${raw}`);
    }
    return url;
}
