/**
 * SCP Hub execution credential: an API key exchanged for the OpenXLab SSO
 * bearer through the moce `/apikey` endpoints. The key outlives the JWT, so
 * it is cached in the credential store (scope: environment + sso uid) and
 * re-requested only after its service-reported expiry, mirroring the
 * registry client's STS ticket lifecycle.
 *
 * @module dsh-plugin-inkstone/scphub/credential
 */
import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials';
/** Deployment selector for the SCP Hub endpoints. */
export type ScpHubEnvironment = 'staging' | 'production';
/** The credential-store surface this exchange consumes. */
export interface ScpHubCredentialStore {
    /** Read one durable record; `undefined` when absent. */
    readRecord(key: ReturnType<typeof credentialKey>): Promise<CredentialRecord | undefined>;
    /** Write one durable record through a producer. */
    modifyRecord(key: ReturnType<typeof credentialKey>, produce: () => Promise<CredentialRecord>): Promise<CredentialRecord | undefined>;
    /** Remove one durable record. */
    deleteRecord(key: ReturnType<typeof credentialKey>): Promise<void>;
}
/** The persisted API key grant. */
export interface ScpHubApiKeyGrant {
    readonly id: string;
    readonly apiKey: string;
    readonly expiresAtMs: number;
}
/** Resolved deployment configuration for the credential exchange. */
export interface ScpHubCredentialConfig {
    /** moce API base, for example `https://discovery-staging.intern-ai.org.cn/api/moce/v1`. */
    readonly apiBaseUrl: string;
    /** Deployment selector; keys the credential-store record. */
    readonly environment: ScpHubEnvironment;
    /** Injectable fetch for tests; defaults to global fetch. */
    readonly fetchImpl?: typeof fetch;
}
/** Parse one `"YYYY-MM-DD HH:mm:ss"` Shanghai timestamp into epoch ms. */
export declare function shanghaiTimestampMs(value: string): number;
/** The API key name this client requests, dated in Asia/Shanghai. */
export declare function automaticApiKeyName(now: Date): string;
/** Options for {@link ScpHubApiKey}. */
export interface ScpHubApiKeyOptions extends ScpHubCredentialConfig {
    /** Supplies the SSO bearer and its uid. */
    readonly identity: () => Promise<{
        bearer: string;
        userId: string | null;
    }>;
    /** Injectable clock for tests; defaults to Date. */
    readonly now?: () => Date;
}
/**
 * The SCP Hub API-key exchange: find an active key with this client's name,
 * creating one when none exists, and keep the winner in the credential store.
 */
export declare class ScpHubApiKey {
    #private;
    /**
     * @param store - credential store for the persisted grant.
     * @param options - endpoints, identity supplier, and test hooks.
     */
    constructor(store: ScpHubCredentialStore, options: ScpHubApiKeyOptions);
    /**
     * The API key value, exchanging or renewing when the cached grant expired.
     * @returns the `SCP-HUB-API-KEY` value.
     */
    apiKey(): Promise<string>;
    /** Forget the cached grant; the next call exchanges a new key. */
    invalidate(): void;
}
