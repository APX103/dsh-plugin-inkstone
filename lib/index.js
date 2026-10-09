import z from "@deepseek-ai/schemastery";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { Service } from "@deepseek-ai/cordis";
import { credentialKey } from "@deepseek-ai/dsh-credentials";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Remote, RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { brandString } from "@deepseek-ai/dsh-brand";
import { AgentCard, GetTaskRequest, Role, SendMessageRequest, TaskState } from "@a2a-js/sdk";
import { isIP } from "node:net";
import { ClientFactory, JsonRpcTransportFactory, RestTransportFactory } from "@a2a-js/sdk/client";
import { assertSupportedJsonSchema, defineTool } from "@deepseek-ai/dsh-tools";
import { delegationDepthOf } from "@deepseek-ai/dsh-subagent";
import { isDeepStrictEqual } from "node:util";
import { isImageAdmissionError } from "@deepseek-ai/dsh-attachment";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
//#region lib/types/registry/error.js
/**
* Agent-registry client failure vocabulary: one error class with stable codes
* covering the SSO handshake, STS exchange, and directory discovery.
*
* @module dsh-plugin-inkstone/registry/error
*/
/** One agent-registry client failure carrying a stable {@link RegistryErrorCode}. */
var RegistryError = class extends Error {
	/** Stable classification of the failure. */
	code;
	constructor(code, message, options) {
		super(message, options);
		this.name = "RegistryError";
		this.code = code;
	}
};
//#endregion
//#region lib/types/registry/sso.js
/**
* OpenXLab SSO identity: the AK/SK handshake (auth → HMAC-SHA1 nonce →
* getJwt), refresh-token renewal, single-flight token access, and early
* refresh with a safety margin. Ported from the registry-sdk reference
* implementations (rust/registry-sdk/src/sso.rs).
*
* @module dsh-plugin-inkstone/registry/sso
*/
/** Default staging SSO gateway; production uses the openapi host. */
const OPENXLAB_DEFAULT_BASE_URL = "https://sso.staging.openxlab.org.cn/gw/uaa-be/api/v1/open";
/** Refresh this long before expiry so a cached token never runs out mid-call. */
const REFRESH_MARGIN_MS = 300 * 1e3;
/** Assume one hour of validity when the gateway omits a parseable expiry. */
const UNKNOWN_EXPIRY_MS = 3600 * 1e3;
/**
* One OpenXLab SSO session bound to one AK/SK pair.
*/
var OpenXLabSso = class {
	#options;
	#fetch;
	#now;
	#tokens;
	#inflight;
	constructor(options) {
		this.#options = options;
		this.#fetch = options.fetchImpl ?? fetch;
		this.#now = options.now ?? Date.now;
	}
	/**
	* Resolve a usable bearer token, refreshing or re-authenticating as needed.
	* Concurrent callers share one in-flight refresh.
	* @returns the bare JWT (no `Bearer` prefix).
	* @throws RegistryError on gateway rejection, network, or malformed responses.
	*/
	async bearerToken() {
		return (await this.#resolve()).jwt;
	}
	/**
	* Mark the cached token rejected so the next call re-authenticates.
	* @param token - the rejected token; when omitted, any cached token is dropped.
	*/
	invalidate(token) {
		if (token === void 0 || this.#tokens?.jwt === token) this.#tokens = void 0;
	}
	/**
	* Report the cached token state without network activity.
	* @returns the current token state.
	*/
	state() {
		return {
			authenticated: this.#tokens !== void 0 && this.#now() + REFRESH_MARGIN_MS < this.#tokens.expiresAtMs,
			expiresAtMs: this.#tokens?.expiresAtMs,
			userId: this.#tokens?.userId
		};
	}
	async #resolve() {
		if (this.#tokens !== void 0 && this.#now() + REFRESH_MARGIN_MS < this.#tokens.expiresAtMs) return this.#tokens;
		this.#inflight ??= this.#refresh();
		try {
			return await this.#inflight;
		} finally {
			this.#inflight = void 0;
		}
	}
	async #refresh() {
		const current = this.#tokens;
		if (current !== void 0 && current.refreshToken !== "") try {
			return this.#adopt(await this.#tokensOf("refreshJwt", {
				ak: this.#options.ak,
				refresh_token: current.refreshToken
			}));
		} catch {}
		return this.#adopt(await this.#handshake());
	}
	async #handshake() {
		const auth = this.#parseEnvelope((await this.#post("/auth", { ak: this.#options.ak })).data);
		const nonce = readString(auth.nonce);
		const algorithm = readString(auth.algorithm);
		if (nonce === "") throw new RegistryError("sso-malformed", "SSO auth response carried no nonce");
		if (algorithm !== "" && algorithm !== "HmacSHA1") throw new RegistryError("sso-algorithm", `SSO negotiated an unsupported signature algorithm: ${algorithm}`);
		const signature = createHmac("sha1", this.#options.sk).update(nonce).digest("base64");
		return this.#tokensOf("getJwt", {
			ak: this.#options.ak,
			d: signature
		});
	}
	async #tokensOf(path, body) {
		return this.#parseTokens(this.#parseEnvelope((await this.#post(`/${path}`, body)).data));
	}
	async #post(path, body) {
		const base = (this.#options.baseUrl ?? "https://sso.staging.openxlab.org.cn/gw/uaa-be/api/v1/open").replace(/\/$/, "");
		let response;
		try {
			response = await this.#fetch(`${base}${path}`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json"
				},
				body: JSON.stringify(body),
				redirect: "error"
			});
		} catch (error) {
			throw new RegistryError("sso-network", "SSO gateway unreachable", { cause: error });
		}
		if (response.status !== 200) throw new RegistryError("sso-rejected", `SSO gateway returned status ${response.status}`);
		let envelope;
		try {
			envelope = await response.json();
		} catch (error) {
			throw new RegistryError("sso-malformed", "SSO response is not JSON", { cause: error });
		}
		return unwrapEnvelope(envelope);
	}
	#parseEnvelope(value) {
		if (value === null || typeof value !== "object") throw new RegistryError("sso-malformed", "SSO auth payload is not an object");
		return value;
	}
	#parseTokens(value) {
		const data = this.#parseEnvelope(value);
		const jwt = readString(data.jwt).replace(/^Bearer /, "");
		if (jwt === "") throw new RegistryError("sso-malformed", "SSO response carried no jwt");
		return {
			jwt,
			refreshToken: readString(data.refresh_token),
			expiresAtMs: this.#now() + parseExpiry(data.expiration, this.#now),
			userId: readBlankableString(data.sso_uid)
		};
	}
	#adopt(tokens) {
		this.#tokens = tokens;
		return tokens;
	}
};
/**
* Read one optional gateway string field.
* @param value - the raw field.
* @returns the string, or empty when the field is absent or not a string.
*/
function readString(value) {
	if (typeof value === "string") return value;
	return "";
}
/**
* Read one optional gateway string field where the empty string means absent.
* @param value - the raw field.
* @returns the string, or undefined when absent, empty, or not a string.
*/
function readBlankableString(value) {
	const text = readString(value);
	return text !== "" ? text : void 0;
}
/**
* Unwrap the SSO envelope, peeling the openapi/staging double wrap and
* applying the HTTP-200-with-success:false rejection contract.
* @param value - the parsed response body.
* @returns the inner `data` object.
* @throws RegistryError (`sso-rejected` or `sso-malformed`) on rejection or a malformed envelope.
*/
function unwrapEnvelope(value) {
	if (value === null || typeof value !== "object") throw new RegistryError("sso-malformed", "SSO response is not an envelope object");
	let envelope = value;
	const looksNested = (candidate) => {
		if (candidate === null || typeof candidate !== "object") return false;
		const nested = candidate;
		return (nested.msgCode !== void 0 || nested.msg !== void 0) && nested.data !== void 0;
	};
	if (looksNested(envelope.data)) envelope = envelope.data;
	const msg = typeof envelope.msg === "string" ? envelope.msg : "";
	if (envelope.success === false || envelope.success === void 0 && msg !== "ok") throw new RegistryError("sso-rejected", `SSO rejected the request (msgCode=${typeof envelope.msgCode === "string" ? envelope.msgCode : ""}, msg=${msg})`);
	return {
		msg,
		msgCode: readBlankableString(envelope.msgCode),
		data: envelope.data
	};
}
/**
* Parse the token `expiration` field: unix seconds or an RFC3339 timestamp;
* unparseable values assume one hour of validity.
* @param value - the raw field.
* @param now - the clock.
* @returns remaining milliseconds.
*/
function parseExpiry(value, now) {
	if (typeof value === "string") {
		const seconds = Number(value);
		if (Number.isFinite(seconds) && seconds > now() / 1e3) return Math.max(0, (seconds - now() / 1e3) * 1e3);
		const parsed = Date.parse(value);
		if (Number.isFinite(parsed) && parsed > now()) return parsed - now();
	}
	return UNKNOWN_EXPIRY_MS;
}
//#endregion
//#region lib/types/registry/sts.js
/**
* Per-agent data-plane credentials: dispatches on the registry's
* `auth_scheme_type`, exchanging short-lived tokens through the unified STS
* endpoint for `token_exchange` and `orbit_jwt` agents and honoring the real
* token TTL (live tickets live about sixty seconds) in the cache.
*
* @module dsh-plugin-inkstone/registry/sts
*/
/** The fixed STS exchange path under the registry root. */
const STS_PATH = "/api/v1/a2a/sts/token";
/** Stop trusting a cached ticket this long before its expiry. */
const EXPIRY_MARGIN_MS = 30 * 1e3;
/** Assume half an hour when no expiry signal survives parsing. */
const FALLBACK_TTL_MS = 1800 * 1e3;
/**
* One STS exchange bound to one registry root and identity source.
*/
var StsExchange = class {
	#options;
	#fetch;
	#now;
	#cache = /* @__PURE__ */ new Map();
	#inflight = /* @__PURE__ */ new Map();
	constructor(options) {
		this.#options = options;
		this.#fetch = options.fetchImpl ?? fetch;
		this.#now = options.now ?? Date.now;
	}
	/**
	* Resolve the data-plane headers for one agent under its auth scheme.
	* `none` returns no headers without a registry call; `http` forwards the
	* SSO bearer directly; `token_exchange` and `orbit_jwt` exchange through
	* the STS endpoint with a TTL-honoring cache.
	* @param agentName - the registry resource `name` exactly as discovery returned it.
	* @param scheme - the resource's `auth_scheme_type`.
	* @returns header name/value pairs for the agent's endpoint.
	* @throws RegistryError on unsupported schemes and exchange failures.
	*/
	async headersFor(agentName, scheme) {
		if (scheme === "none") return {};
		if (scheme === "http") {
			const { bearer } = await this.#options.identity();
			return { Authorization: `Bearer ${bearer}` };
		}
		if (scheme !== "token_exchange" && scheme !== "orbit_jwt") throw new RegistryError("scheme-unsupported", `auth scheme "${scheme}" is not supported for agent "${agentName}"`);
		const cached = this.#cache.get(agentName);
		if (cached !== void 0 && this.#now() + EXPIRY_MARGIN_MS < cached.expiresAtMs) return cached.headers;
		this.#inflight ??= /* @__PURE__ */ new Map();
		let pending = this.#inflight.get(agentName);
		if (pending === void 0) {
			pending = this.#exchange(agentName);
			this.#inflight.set(agentName, pending);
		}
		try {
			return await pending;
		} finally {
			this.#inflight.delete(agentName);
		}
	}
	/**
	* Drop cached tickets so the next call exchanges fresh ones.
	* @param agentName - one agent's tickets; omit to clear every agent.
	*/
	invalidate(agentName) {
		if (agentName === void 0) this.#cache.clear();
		else this.#cache.delete(agentName);
	}
	async #exchange(agentName) {
		const { bearer, userId } = await this.#options.identity();
		const headers = new Headers({
			"content-type": "application/json",
			accept: "application/json",
			authorization: `Bearer ${bearer}`
		});
		if (userId !== void 0) headers.set("X-User-Id", userId);
		let response;
		try {
			response = await this.#fetch(`${this.#options.registryBaseUrl.replace(/\/$/, "")}${STS_PATH}`, {
				method: "POST",
				headers,
				body: JSON.stringify({ agent_id: agentName }),
				redirect: "error"
			});
		} catch (error) {
			throw new RegistryError("sts-network", "registry STS endpoint unreachable", { cause: error });
		}
		if (response.status !== 200) throw new RegistryError("sts-http", `STS exchange returned status ${response.status} for agent "${agentName}"`);
		let body;
		try {
			body = await response.json();
		} catch (error) {
			throw new RegistryError("sts-malformed", "STS response is not JSON", { cause: error });
		}
		const data = extractStsData(body);
		const accessToken = typeof data.access_token === "string" ? data.access_token : "";
		if (accessToken === "") throw new RegistryError("sts-malformed", `STS response carried no access_token for agent "${agentName}"`);
		const resolved = stsHeaders(data, accessToken, userId);
		const ttl = stsTtlMs(data, resolved, this.#now);
		const cached = {
			headers: resolved.headers,
			expiresAtMs: this.#now() + ttl
		};
		this.#cache.set(agentName, cached);
		return resolved.headers;
	}
};
/**
* Extract the `data` object from the `{code, msg, data}` business envelope.
* @param body - the parsed response body.
* @returns the inner data object, or the body itself when unwrapped.
* @throws RegistryError (`sts-malformed`) when the shape is unusable.
*/
function extractStsData(body) {
	if (body === null || typeof body !== "object") throw new RegistryError("sts-malformed", "STS response is not an object");
	const record = body;
	return record.data !== void 0 && record.data !== null && typeof record.data === "object" ? record.data : record;
}
/**
* Build the data-plane headers from one STS payload.
* @param data - the STS `data` object.
* @param accessToken - the validated access token.
* @param userId - the SSO user id, forwarded when the payload carries none.
* @returns the headers plus their bearer token for TTL inspection.
*/
function stsHeaders(data, accessToken, userId) {
	const raw = data.rpc_auth_headers;
	if (raw !== void 0 && raw !== null && typeof raw === "object") {
		const headers = {};
		for (const [key, value] of Object.entries(raw)) if (typeof value === "string") headers[key] = value;
		if (Object.keys(headers).length > 0) return {
			headers,
			bearer: headers.Authorization?.replace(/^Bearer /, "") ?? accessToken
		};
	}
	const headers = { Authorization: `Bearer ${accessToken}` };
	const uid = typeof data.user_id === "string" && data.user_id !== "" ? data.user_id : userId;
	if (uid !== void 0) headers["X-User-ID"] = uid;
	return {
		headers,
		bearer: accessToken
	};
}
/**
* Compute the cache TTL: the `expires_at` field (RFC3339 or unix seconds),
* then the JWT `exp` claim, then a fallback. Live tickets are short, so a
* misread TTL sends dead tickets as if live.
* @param data - the STS `data` object.
* @param resolved - the resolved headers with their bearer.
* @param now - the clock.
* @returns remaining milliseconds.
*/
function stsTtlMs(data, resolved, now) {
	const expiresAt = data.expires_at;
	if (typeof expiresAt === "string" && expiresAt !== "") {
		if (!/^[\d.]+$/.test(expiresAt)) {
			const parsed = Date.parse(expiresAt);
			if (Number.isFinite(parsed)) return Math.max(0, parsed - now());
		}
		const seconds = Number(expiresAt);
		if (Number.isFinite(seconds) && seconds > 0) return Math.max(0, seconds * 1e3 - now());
	}
	const exp = jwtExpSeconds(resolved.bearer);
	if (exp !== void 0) return Math.max(0, exp * 1e3 - now());
	return FALLBACK_TTL_MS;
}
/**
* Read the `exp` claim of one unverified JWT purely for cache timing.
* @param token - the bearer JWT.
* @returns the expiry in unix seconds, or undefined when unreadable.
*/
function jwtExpSeconds(token) {
	const segments = token.split(".");
	if (segments.length !== 3) return;
	try {
		const payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
		return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : void 0;
	} catch {
		return;
	}
}
//#endregion
//#region lib/types/registry/discovery.js
/**
* Registry directory discovery over MCP streamable HTTP: connects to the
* registry's `/mcp` endpoint with the live SSO bearer and calls the
* `list_resources` tool for the A2A catalog.
*
* @module dsh-plugin-inkstone/registry/discovery
*/
/** The registry's MCP endpoint path. */
const MCP_PATH = "/mcp";
/** The directory page size; the registry hard-caps at one hundred. */
const LIST_LIMIT = 100;
/**
* One registry directory reader. Each {@link RegistryDirectory.list} call
* opens a fresh MCP connection with the current bearer and closes it after.
*/
var RegistryDirectory = class {
	#options;
	constructor(options) {
		this.#options = options;
	}
	/**
	* List the visible A2A agents (including registry-probe-failed ones).
	* @param signal - cooperative cancellation for the directory call.
	* @returns the entries in registry order.
	* @throws RegistryError on transport, protocol, or shape failures.
	*/
	async list(signal) {
		const url = new URL(`${this.#options.registryBaseUrl.replace(/\/$/, "")}${MCP_PATH}`);
		const transportOptions = { authProvider: { token: () => this.#options.bearer() } };
		if (this.#options.fetchImpl !== void 0) transportOptions.fetch = this.#options.fetchImpl;
		const transport = new StreamableHTTPClientTransport(url, transportOptions);
		const client = new Client({
			name: "dsh-plugin-inkstone",
			version: "0.1.0"
		}, { capabilities: {} });
		try {
			signal?.throwIfAborted();
			await client.connect(transport);
			signal?.throwIfAborted();
			return parseAgentEntries(await client.callTool({
				name: "list_resources",
				arguments: {
					kind: "a2a",
					healthy_only: false,
					limit: LIST_LIMIT
				}
			}, signal !== void 0 ? { signal } : void 0));
		} catch (error) {
			if (error instanceof RegistryError) throw error;
			throw new RegistryError("discovery-http", "registry directory call failed", { cause: error });
		} finally {
			await client.close().catch(
				/* v8 ignore next -- close rejection has no observable effect to assert */
				() => {}
			);
		}
	}
};
/**
* Parse the `list_resources` tool result into validated agent entries.
* @param result - the MCP callTool result.
* @returns the validated entries; non-a2a rows are skipped.
* @throws RegistryError (`discovery-malformed`) when the payload is unusable.
*/
function parseAgentEntries(result) {
	const text = toolResultText(result);
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new RegistryError("discovery-malformed", "list_resources payload is not JSON", { cause: error });
	}
	const root = parsed;
	if (root === null || typeof root !== "object" || !Array.isArray(root.results)) throw new RegistryError("discovery-malformed", "list_resources payload carries no results array");
	const entries = [];
	for (const row of root.results) {
		if (row === null || typeof row !== "object") continue;
		const record = row;
		if (record.kind !== void 0 && record.kind !== "a2a") continue;
		const name = typeof record.name === "string" ? record.name : "";
		const endpointUrl = typeof record.endpoint_url === "string" ? record.endpoint_url : "";
		if (name === "" || endpointUrl === "") throw new RegistryError("discovery-malformed", "list_resources row lacks name or endpoint_url");
		const authScheme = typeof record.auth_scheme_type === "string" ? record.auth_scheme_type : "none";
		entries.push({
			name,
			uri: typeof record.uri === "string" ? record.uri : void 0,
			description: typeof record.description === "string" ? record.description : "",
			endpointUrl,
			authScheme,
			probeStatus: typeof record.probe_status === "string" ? record.probe_status : ""
		});
	}
	return entries;
}
/**
* Extract the first text part of one MCP callTool result.
* @param result - the callTool result.
* @returns its text content.
* @throws RegistryError (`discovery-malformed`) when no text part exists.
*/
function toolResultText(result) {
	if (result === null || typeof result !== "object") throw new RegistryError("discovery-malformed", "list_resources result is not an object");
	const content = result.content;
	if (!Array.isArray(content)) throw new RegistryError("discovery-malformed", "list_resources result carries no content parts");
	for (const part of content) if (part !== null && typeof part === "object" && part.type === "text") {
		const text = part.text;
		if (typeof text === "string") return text;
	}
	throw new RegistryError("discovery-malformed", "list_resources result carries no text part");
}
//#endregion
//#region lib/types/registry/service.js
/**
* The host-side agent-registry service (`ctx.a2aRegistry`): owns the OpenXLab
* SSO session built from stored AK/SK credentials, exposes login/logout and
* status, discovers the A2A directory over MCP, and resolves per-agent
* data-plane headers through the STS exchange for delegation consumers.
*
* The Cordis service is a thin shell over {@link RegistryClientCore}; the
* shell keeps only public members because the root Context hands consumers a
* tracing proxy where private members are inaccessible.
*
* @module dsh-plugin-inkstone/registry/service
*/
const GRANT_KEY = credentialKey("a2a-registry", "openxlab");
/**
* The registry client core: SSO lifecycle, STS exchange, and directory
* discovery over one credential store and deployment configuration.
*/
var RegistryClientCore = class {
	#store;
	#config;
	#sso;
	#ssoAk = "";
	#sts;
	#directory;
	constructor(store, config) {
		this.#store = store;
		this.#config = config;
	}
	/**
	* Report the login state without network activity.
	* @returns whether credentials are stored and the cached token state.
	*/
	async status() {
		const grant = await this.#readGrant();
		if (grant === void 0) return {
			configured: false,
			registryBaseUrl: this.#config.registryBaseUrl,
			authenticated: false,
			expiresAtMs: void 0,
			userId: void 0
		};
		try {
			await this.#ssoFor(grant).bearerToken();
		} catch {}
		return {
			configured: true,
			registryBaseUrl: this.#config.registryBaseUrl,
			...this.#ssoFor(grant).state()
		};
	}
	/**
	* Store an AK/SK pair and prime the SSO session, rejecting bad pairs.
	* @param ak - the access key.
	* @param sk - the secret key.
	*/
	async login(ak, sk) {
		if (ak.trim() === "" || sk.trim() === "") throw new RegistryError("sso-missing", "both access key and secret key are required");
		const sso = this.#newSso(ak.trim(), sk.trim());
		await sso.bearerToken();
		await this.#store.modifyRecord(GRANT_KEY, async () => ({
			kind: "grant",
			payload: {
				ak: ak.trim(),
				sk: sk.trim()
			}
		}));
		this.#sso = sso;
		this.#ssoAk = ak.trim();
		this.#resetLazies();
	}
	/**
	* Remove the stored AK/SK pair and every in-memory token.
	*/
	async logout() {
		await this.#store.deleteRecord(GRANT_KEY);
		this.#sso = void 0;
		this.#ssoAk = "";
		this.#resetLazies();
	}
	/**
	* Discover the visible A2A agents from the registry directory.
	* @param signal - cooperative cancellation.
	* @returns the directory entries.
	* @throws RegistryError (`not-configured`) before login.
	*/
	async discover(signal) {
		const grant = await this.#requireGrant();
		this.#directory ??= new RegistryDirectory({
			registryBaseUrl: this.#config.registryBaseUrl,
			bearer: () => this.#bearer(grant),
			...this.#fetchOption()
		});
		return await this.#directory.list(signal);
	}
	/**
	* Resolve the data-plane headers for one agent under its auth scheme.
	* @param agentName - the registry resource name.
	* @param scheme - the resource's auth scheme.
	* @returns header name/value pairs for the agent's endpoint.
	*/
	async agentHeaders(agentName, scheme) {
		const grant = await this.#requireGrant();
		this.#sts ??= new StsExchange({
			registryBaseUrl: this.#config.registryBaseUrl,
			identity: async () => ({
				bearer: await this.#bearer(grant),
				userId: this.#ssoFor(grant).state().userId
			}),
			...this.#fetchOption()
		});
		return await this.#sts.headersFor(agentName, scheme);
	}
	/**
	* Drop cached STS tickets so the next call exchanges fresh ones.
	* @param agentName - one agent; omit to clear every agent.
	*/
	invalidateTickets(agentName) {
		this.#sts?.invalidate(agentName);
	}
	/**
	* The current SSO bearer and uid; shared with sibling services (SCP Hub)
	* so one OpenXLab session serves every consumer.
	* @returns the bearer token and user id.
	* @throws RegistryError (`not-configured`) before login.
	*/
	async identity() {
		const grant = await this.#requireGrant();
		const userId = this.#ssoFor(grant).state().userId;
		return {
			bearer: await this.#bearer(grant),
			userId: userId === void 0 ? null : userId
		};
	}
	#fetchOption() {
		return this.#config.fetchImpl !== void 0 ? { fetchImpl: this.#config.fetchImpl } : {};
	}
	#newSso(ak, sk) {
		return new OpenXLabSso({
			ak,
			sk,
			baseUrl: this.#config.ssoBaseUrl,
			...this.#fetchOption()
		});
	}
	#resetLazies() {
		this.#sts = void 0;
		this.#directory = void 0;
	}
	async #readGrant() {
		const record = await this.#store.readRecord(GRANT_KEY);
		const payload = record?.kind === "grant" ? record.payload : void 0;
		if (payload === void 0 || typeof payload.ak !== "string" || typeof payload.sk !== "string") return;
		return {
			ak: payload.ak,
			sk: payload.sk
		};
	}
	async #requireGrant() {
		const grant = await this.#readGrant();
		if (grant === void 0) throw new RegistryError("not-configured", "no OpenXLab credentials stored; sign in on the A2A settings page first");
		return grant;
	}
	#ssoFor(grant) {
		if (this.#sso === void 0 || this.#ssoAk !== grant.ak) {
			this.#sso = this.#newSso(grant.ak, grant.sk);
			this.#ssoAk = grant.ak;
		}
		return this.#sso;
	}
	#bearer(grant) {
		return this.#ssoFor(grant).bearerToken();
	}
};
/**
* The `ctx.a2aRegistry` service shell over {@link RegistryClientCore}.
*/
var A2aRegistryService = class extends Service {
	static inject = ["credentials"];
	/** The client core this shell exposes; public for tracing-proxy access. */
	core;
	constructor(ctx, config) {
		super(ctx, "a2aRegistry");
		this.core = new RegistryClientCore(ctx.credentials, config);
	}
	/** @returns the login state without network activity. */
	status() {
		return this.core.status();
	}
	/**
	* Store an AK/SK pair and prime the SSO session.
	* @param ak - the access key.
	* @param sk - the secret key.
	*/
	login(ak, sk) {
		return this.core.login(ak, sk);
	}
	/** Remove the stored AK/SK pair and every in-memory token. */
	logout() {
		return this.core.logout();
	}
	/**
	* The current SSO bearer and uid, shared with sibling services.
	* @returns the bearer token and user id.
	*/
	identity() {
		return this.core.identity();
	}
	/**
	* Discover the visible A2A agents.
	* @param signal - cooperative cancellation.
	* @returns the directory entries.
	*/
	discover(signal) {
		return this.core.discover(signal);
	}
	/**
	* Resolve the data-plane headers for one agent.
	* @param agentName - the registry resource name.
	* @param scheme - the resource's auth scheme.
	* @returns header name/value pairs.
	*/
	agentHeaders(agentName, scheme) {
		return this.core.agentHeaders(agentName, scheme);
	}
	/**
	* Drop cached STS tickets.
	* @param agentName - one agent; omit to clear every agent.
	*/
	invalidateTickets(agentName) {
		this.core.invalidateTickets(agentName);
	}
};
//#endregion
//#region lib/types/remote/index.js
/**
* Authenticated browser access to the experimental agent-registry client:
* login state and sign-in for the OpenXLab SSO lifecycle, and A2A directory
* discovery. Per-agent credential headers stay Host-side — no method here
* returns a token or ticket.
*
* @module dsh-plugin-inkstone/remote
*/
var __runInitializers$1 = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate$1 = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
		else descriptor[key] = _;
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
/** Project the login state onto its wire view. */
function statusView(state) {
	return {
		configured: state.configured,
		authenticated: state.authenticated,
		registryBaseUrl: state.registryBaseUrl,
		expiresAtMs: state.expiresAtMs ?? null,
		userId: state.userId ?? null
	};
}
/** Project one directory entry onto its wire view. */
function agentView(entry) {
	return {
		name: entry.name,
		uri: entry.uri ?? null,
		description: entry.description,
		endpointUrl: entry.endpointUrl,
		authScheme: entry.authScheme,
		probeStatus: entry.probeStatus
	};
}
/**
* Classify one registry-client failure as a Remote failure. The AK/SK pair
* never appears in a reason string.
*/
function remoteFailure$1(error) {
	/* v8 ignore next 3 -- unreachable from this controller's own services */
	if (error instanceof RemoteError) return error;
	let reason;
	/* v8 ignore next 5 -- the registry client throws Error values only */
	if (error instanceof Error) reason = error.message;
	else reason = String(error);
	if (error instanceof RegistryError) {
		if (error.code.startsWith("sso-") || error.code === "not-configured") {
			let code;
			if (error.code === "not-configured") code = "a2a/not-configured";
			else code = "a2a/sso-rejected";
			return new RemoteError(code, reason, { reason });
		}
		return new RemoteError("a2a/discovery-unavailable", reason, { reason });
	}
	return new RemoteError("a2a/discovery-unavailable", reason, { reason });
}
let A2aRegistryController = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _status_decorators;
	let _login_decorators;
	let _logout_decorators;
	let _discover_decorators;
	return class A2aRegistryController extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_status_decorators = [Remote];
			_login_decorators = [Remote];
			_logout_decorators = [Remote];
			_discover_decorators = [Remote];
			__esDecorate$1(this, null, _status_decorators, {
				kind: "method",
				name: "status",
				static: false,
				private: false,
				access: {
					has: (obj) => "status" in obj,
					get: (obj) => obj.status
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate$1(this, null, _login_decorators, {
				kind: "method",
				name: "login",
				static: false,
				private: false,
				access: {
					has: (obj) => "login" in obj,
					get: (obj) => obj.login
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate$1(this, null, _logout_decorators, {
				kind: "method",
				name: "logout",
				static: false,
				private: false,
				access: {
					has: (obj) => "logout" in obj,
					get: (obj) => obj.logout
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate$1(this, null, _discover_decorators, {
				kind: "method",
				name: "discover",
				static: false,
				private: false,
				access: {
					has: (obj) => "discover" in obj,
					get: (obj) => obj.discover
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		static inject = ["a2aRegistry"];
		/** @param ctx - Host context where the registry client service is mounted. */
		constructor(ctx) {
			super(ctx, "a2aRegistryController", { namespace: "a2aRegistry" });
			__runInitializers$1(this, _instanceExtraInitializers);
		}
		/**
		* Read the login state without network activity.
		* @returns whether credentials are stored and the cached token state.
		*/
		async status() {
			return statusView(await this.ctx.a2aRegistry.status());
		}
		/**
		* Store an AK/SK pair and prime the SSO session, rejecting bad pairs. The
		* pair crosses the wire in this direction only; no read path returns it.
		* @param ak - the access key.
		* @param sk - the secret key.
		*/
		async login(ak, sk) {
			try {
				await this.ctx.a2aRegistry.login(ak, sk);
			} catch (error) {
				throw remoteFailure$1(error);
			}
		}
		/**
		* Remove the stored AK/SK pair and every in-memory token.
		*/
		async logout() {
			await this.ctx.a2aRegistry.logout();
		}
		/**
		* Discover the visible A2A agents from the registry directory.
		* @param signal - Client cancellation.
		* @returns the directory entries in registry order.
		*/
		async discover(signal) {
			try {
				signal.throwIfAborted();
				return (await this.ctx.a2aRegistry.discover(signal)).map(agentView);
			} catch (error) {
				throw remoteFailure$1(error);
			}
		}
	};
})();
//#endregion
//#region lib/types/a2a/error.js
/**
* A2A client failure vocabulary. One error class with stable codes so the
* delegation provider can map failures to subagent stop reasons without
* parsing message text.
*
* @module dsh-plugin-inkstone/a2a/error
*/
/** One A2A client failure carrying a stable {@link A2aErrorCode}. */
var A2aError = class extends Error {
	/** Stable classification of the failure. */
	code;
	constructor(code, message, options) {
		super(message, options);
		this.name = "A2aError";
		this.code = code;
	}
};
/**
* Classify one thrown error from the A2A SDK or the fetch layer into an
* {@link A2aErrorCode}. Walks the cause chain so transport wrapping does not
* hide the HTTP status.
* @param error - the thrown error from a client call.
* @returns the stable code; `transport` when nothing more specific matches.
*/
function classifyA2aError(error) {
	let current = error;
	const seen = /* @__PURE__ */ new Set();
	while (current instanceof Error && !seen.has(current)) {
		seen.add(current);
		if (/abort/i.test(current.name) || current.message.includes("This operation was aborted")) return "aborted";
		const status = current.status ?? current.statusCode;
		if (status === 401) return "auth";
		if (status === 403) return "forbidden";
		if (/\b401\b|unauthorized/i.test(current.message)) return "auth";
		if (/\b403\b|forbidden/i.test(current.message)) return "forbidden";
		current = current.cause;
	}
	return "transport";
}
//#endregion
//#region lib/types/a2a/states.js
/**
* Task-state classification: the A2A `TaskState` enum mapped onto this
* library's outcome vocabulary with terminal and interrupted predicates.
*
* @module dsh-plugin-inkstone/a2a/states
*/
/**
* Map one A2A task state onto the outcome vocabulary.
* @param state - the protocol task state.
* @returns the outcome; `unknown` for `UNSPECIFIED` and unrecognized values.
*/
function classifyTaskState(state) {
	switch (state) {
		case TaskState.TASK_STATE_SUBMITTED: return "submitted";
		case TaskState.TASK_STATE_WORKING: return "working";
		case TaskState.TASK_STATE_INPUT_REQUIRED: return "input-required";
		case TaskState.TASK_STATE_AUTH_REQUIRED: return "auth-required";
		case TaskState.TASK_STATE_COMPLETED: return "completed";
		case TaskState.TASK_STATE_FAILED: return "failed";
		case TaskState.TASK_STATE_CANCELED: return "canceled";
		case TaskState.TASK_STATE_REJECTED: return "rejected";
		default: return "unknown";
	}
}
/**
* Whether one outcome is a protocol terminal state after which the task
* accepts no further messages.
* @param outcome - the classified outcome.
* @returns true for completed, failed, canceled, and rejected.
*/
function isTerminalOutcome(outcome) {
	return outcome === "completed" || outcome === "failed" || outcome === "canceled" || outcome === "rejected";
}
/**
* Whether one outcome is an interrupted state that expects the client to
* answer (more input or re-authentication) by continuing the same task.
* @param outcome - the classified outcome.
* @returns true for input-required and auth-required.
*/
function isInterruptedOutcome(outcome) {
	return outcome === "input-required" || outcome === "auth-required";
}
//#endregion
//#region lib/types/a2a/parts.js
/**
* Part projection and artifact accumulation: converts A2A protocol parts
* into plain values, detects the platform's reasoning/thinking part
* convention, and merges streamed artifact chunks by artifact id.
*
* @module dsh-plugin-inkstone/a2a/parts
*/
/**
* Detect a reasoning/thinking part by the platform convention: part metadata
* `kind`/`role` equal to `reasoning`, a reasoning media type, or a data
* object carrying a thinking/reasoning/reasoning_content field.
* @param part - the protocol part.
* @returns whether the part represents reasoning.
*/
function isReasoningPart(part) {
	const kind = part.metadata?.kind;
	const role = part.metadata?.role;
	if (kind === "reasoning" || role === "reasoning") return true;
	if (part.mediaType.includes("reasoning")) return true;
	const data = part.content?.$case === "data" ? part.content.value : void 0;
	if (data !== null && data !== void 0 && typeof data === "object") {
		const fields = data;
		return [
			"thinking",
			"reasoning",
			"reasoning_content"
		].some((key) => key in fields);
	}
	return false;
}
/**
* Project one protocol part to a plain value.
* @param part - the protocol part.
* @returns the projected part with its reasoning classification.
*/
function projectPart(part) {
	const reasoning = isReasoningPart(part);
	const content = part.content;
	if (content === void 0) return {
		kind: "text",
		text: "",
		mediaType: part.mediaType,
		reasoning
	};
	switch (content.$case) {
		case "text": return {
			kind: "text",
			text: content.value,
			mediaType: part.mediaType,
			reasoning
		};
		case "data": return {
			kind: "data",
			data: content.value,
			mediaType: part.mediaType,
			reasoning
		};
		case "url": return {
			kind: "file",
			url: content.value,
			mediaType: part.mediaType,
			reasoning,
			...part.filename !== "" ? { filename: part.filename } : {}
		};
		case "raw": return {
			kind: "file",
			base64: Buffer.from(content.value).toString("base64"),
			mediaType: part.mediaType,
			reasoning,
			...part.filename !== "" ? { filename: part.filename } : {}
		};
	}
}
/**
* Join the text of a part list.
* @param parts - projected parts.
* @param options - `reasoning` selects reasoning parts instead of ordinary text.
* @returns the concatenated text.
*/
function joinPartText(parts, options) {
	const wantReasoning = options?.reasoning === true;
	return parts.filter((part) => part.kind === "text").filter((part) => part.reasoning === wantReasoning).map((part) => part.text).join("");
}
/**
* Project one protocol artifact's parts.
* @param artifact - the protocol artifact.
* @returns the projected artifact value.
*/
function projectArtifact(artifact) {
	return {
		artifactId: artifact.artifactId,
		name: artifact.name,
		description: artifact.description,
		parts: artifact.parts.map(projectPart)
	};
}
/**
* Project one protocol message's parts.
* @param message - the protocol message.
* @returns the projected parts.
*/
function projectMessageParts(message) {
	return message.parts.map(projectPart);
}
/**
* Merge one streamed artifact update into the accumulating artifact map.
* @param artifacts - the mutable map keyed by artifact id; updated in place.
* @param event - the streamed artifact update event.
*/
function mergeArtifactUpdate(artifacts, event) {
	const artifact = event.artifact;
	if (artifact === void 0) return;
	const projected = projectArtifact(artifact);
	const existing = artifacts.get(artifact.artifactId);
	if (event.append && existing !== void 0) artifacts.set(artifact.artifactId, {
		...existing,
		parts: [...existing.parts, ...projected.parts]
	});
	else artifacts.set(artifact.artifactId, projected);
}
//#endregion
//#region lib/types/a2a/url.js
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
function assertA2aEndpointUrl(raw) {
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new A2aError("endpoint", `invalid A2A endpoint URL: ${raw}`);
	}
	if (url.username !== "" || url.password !== "") throw new A2aError("endpoint", "A2A endpoint URL must not carry credentials");
	if (url.search !== "" || url.hash !== "") throw new A2aError("endpoint", "A2A endpoint URL must not carry a query or fragment");
	const host = url.hostname;
	const bareHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	const loopback = url.protocol === "http:" && isIP(bareHost) !== 0 && (bareHost === "127.0.0.1" || bareHost === "::1");
	if (url.protocol !== "https:" && !loopback) throw new A2aError("endpoint", `A2A endpoint URL must be HTTPS (or loopback HTTP): ${raw}`);
	return url;
}
//#endregion
//#region lib/types/a2a/client.js
/**
* The A2A agent client: resolves and validates one agent's card, then runs
* streaming turns and reads tasks over the official SDK transport. Auth
* headers are injected per request; the SSO/STS lifecycle that produces them
* belongs to the caller.
*
* @module dsh-plugin-inkstone/a2a/client
*/
const CARD_PATH = "/.well-known/agent-card.json";
/**
* Anonymous card-probe candidates: the origin root the A2A well-known
* convention names, then the endpoint's parent and grandparent directories
* where sub-path gateways (for example `/agentgateway/a2a/v1`) publish the
* document. All probes are unauthenticated and read-only.
*/
function cardProbeUrls(endpointUrl) {
	const candidates = [new URL(CARD_PATH, endpointUrl).href];
	for (const relative of [".", ".."]) candidates.push(new URL(`${relative}${CARD_PATH}`, endpointUrl).href);
	return [...new Set(candidates)];
}
/**
* Render one thrown failure's message.
* @param error - the thrown value.
* @returns its Error message, or the value's string form.
*/
function failureText(error) {
	if (error instanceof Error) return error.message;
	/* v8 ignore next -- defensive against non-Error rejections */
	return String(error);
}
/**
* Create one A2A agent client bound to a frozen endpoint.
* @param options - endpoint, per-request auth headers, and optional test fetch.
* @returns the agent handle.
* @throws A2aError (`endpoint`) immediately when the endpoint URL is unusable.
*/
function createA2aAgent(options) {
	const endpointUrl = assertA2aEndpointUrl(options.endpointUrl);
	const baseFetch = options.fetchImpl ?? fetch;
	const authedFetch = async (input, init) => {
		const headers = new Headers(init?.headers);
		headers.delete("Authorization");
		for (const [key, value] of Object.entries(await options.authHeaders())) headers.set(key, value);
		return baseFetch(input, {
			...init,
			headers,
			redirect: "error"
		});
	};
	let cached;
	const fetchCard = async () => {
		let card;
		let lastStatus = 0;
		let invalidCard;
		for (const cardUrl of cardProbeUrls(endpointUrl)) {
			const response = await baseFetch(cardUrl, {
				headers: { accept: "application/json" },
				redirect: "error"
			});
			if (!response.ok) {
				lastStatus = response.status;
				continue;
			}
			try {
				card = AgentCard.fromJSON(await response.json());
				break;
			} catch (error) {
				invalidCard = new A2aError("card", `agent card at ${cardUrl} is not a valid card`, { cause: error });
			}
		}
		if (card === void 0) throw invalidCard ?? new A2aError("card", `agent card request returned ${lastStatus} for ${endpointUrl.origin}`);
		let iface = card.supportedInterfaces.find((candidate) => candidate.protocolBinding === "JSONRPC") ?? card.supportedInterfaces.find((candidate) => candidate.protocolBinding === "HTTP+JSON");
		if (iface === void 0) {
			if (card.supportedInterfaces.length > 0) throw new A2aError("card", `agent card at ${endpointUrl.origin} offers no JSON-RPC or HTTP+JSON interface; registry endpoint ${endpointUrl.href} is unusable`);
			iface = {
				url: endpointUrl.href,
				protocolBinding: "JSONRPC",
				protocolVersion: "1.0",
				tenant: ""
			};
			card = {
				...card,
				supportedInterfaces: [iface]
			};
		}
		const index = card.supportedInterfaces.indexOf(iface);
		const supportedInterfaces = card.supportedInterfaces.map((candidate, position) => {
			if (position !== index) return candidate;
			return {
				...candidate,
				url: endpointUrl.href
			};
		});
		return {
			card: {
				...card,
				supportedInterfaces
			},
			summary: {
				name: card.name,
				description: card.description,
				streaming: card.capabilities?.streaming === true,
				protocolVersion: iface.protocolVersion,
				protocolBinding: iface.protocolBinding,
				jsonRpcUrl: endpointUrl.href
			}
		};
	};
	const resolve = async () => {
		if (cached !== void 0) return cached;
		let fetched;
		try {
			fetched = await fetchCard();
		} catch (error) {
			throw error instanceof A2aError ? error : new A2aError("card", "agent card request failed", { cause: error });
		}
		const client = await new ClientFactory({ transports: [new JsonRpcTransportFactory({
			fetchImpl: authedFetch,
			legacyCompat: { enabled: true }
		}), new RestTransportFactory({
			fetchImpl: authedFetch,
			legacyCompat: { enabled: true }
		})] }).createFromAgentCard(fetched.card);
		cached = {
			card: fetched.card,
			summary: fetched.summary,
			client
		};
		return cached;
	};
	const wrap = async (operation) => {
		try {
			return await operation();
		} catch (error) {
			if (error instanceof A2aError) throw error;
			throw new A2aError(classifyA2aError(error), failureText(error), { cause: error });
		}
	};
	return {
		async card() {
			return (await resolve()).summary;
		},
		async runTurn(request) {
			return wrap(async () => {
				request.signal?.throwIfAborted();
				const { client } = await resolve();
				const params = SendMessageRequest.fromJSON({
					message: {
						messageId: randomUUID(),
						...request.contextId !== void 0 ? { contextId: request.contextId } : {},
						...request.taskId !== void 0 ? { taskId: request.taskId } : {},
						role: "ROLE_USER",
						parts: [{
							text: request.text,
							mediaType: "text/plain"
						}]
					},
					configuration: { acceptedOutputModes: [...request.acceptedOutputModes ?? ["text/plain", "text/markdown"]] }
				});
				const recovered = await recoverSilentAnswer(client, await consumeStream(client.sendMessageStream(params), request), request);
				return {
					task: recovered.task,
					contextId: recovered.contextId,
					text: recovered.text,
					reasoning: recovered.reasoning,
					artifacts: recovered.artifacts,
					outcome: recovered.outcome
				};
			});
		},
		async getTask(taskId, options) {
			return wrap(async () => {
				options?.signal?.throwIfAborted();
				const { client } = await resolve();
				return snapshotOfTask(await client.getTask(GetTaskRequest.fromJSON({
					id: taskId,
					...options?.historyLength !== void 0 ? { historyLength: options.historyLength } : {}
				})));
			});
		},
		invalidate() {
			cached = void 0;
		}
	};
}
/**
* Re-read a completed-but-silent turn's task: some agents close the stream
* with only a status-update message and deliver the answer through task
* history or server-side artifacts. The recovery is best-effort — a failed
* history read keeps the streamed outcome.
* @param client - the connected transport client.
* @param consumed - the accumulated stream outcome.
* @param request - the originating turn request, for cancellation.
* @returns the outcome with the history answer applied when one exists.
*/
async function recoverSilentAnswer(client, consumed, request) {
	if (consumed.outcome !== "completed" || consumed.task === void 0 || consumed.messageText !== "" || consumed.artifacts.some((artifact) => artifact.parts.some((part) => part.kind === "text" && part.text !== ""))) return consumed;
	try {
		request.signal?.throwIfAborted();
		const snapshot = snapshotOfTask(await client.getTask(GetTaskRequest.fromJSON({ id: consumed.task.id })));
		const historyText = snapshot.lastAgentText;
		const historyArtifacts = snapshot.artifacts.some((artifact) => artifact.parts.some((part) => part.kind === "text" && part.text !== ""));
		if (historyText === "" && !historyArtifacts) return consumed;
		let text = consumed.text;
		if (historyText !== "") text = historyText;
		let artifacts = consumed.artifacts;
		if (snapshot.artifacts.length > 0) artifacts = snapshot.artifacts;
		return {
			...consumed,
			text,
			artifacts,
			task: {
				...consumed.task,
				state: snapshot.task.state
			}
		};
	} catch {
		return consumed;
	}
}
/**
* Consume one SDK stream generator into a turn outcome, racing cooperative
* cancellation against iteration steps.
* @param stream - the SDK stream generator.
* @param request - the originating turn request.
* @returns the accumulated outcome.
*/
async function consumeStream(stream, request) {
	const state = {
		task: void 0,
		contextId: request.contextId,
		text: "",
		messageText: "",
		reasoning: "",
		artifacts: /* @__PURE__ */ new Map(),
		finalOutcome: void 0
	};
	const iterator = stream[Symbol.asyncIterator]();
	let detachAbort;
	const abortPromise = request.signal === void 0 ? void 0 : new Promise((_, reject) => {
		const signal = request.signal;
		const onAbort = () => {
			reject(new A2aError("aborted", "A2A turn aborted before the stream ended"));
		};
		/* v8 ignore next -- the entry check makes a pre-aborted signal unreachable here */
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
		detachAbort = () => {
			signal.removeEventListener("abort", onAbort);
		};
	});
	try {
		const advance = () => {
			const next = iterator.next();
			next.catch(() => {});
			return abortPromise === void 0 ? next : Promise.race([next, abortPromise]);
		};
		let step = await advance();
		while (step.done !== true) {
			consumeResponse(step.value, state);
			if (state.finalOutcome !== void 0) {
				await closeStream(iterator);
				break;
			}
			step = await advance();
		}
	} catch (error) {
		await closeStream(iterator);
		if (error instanceof A2aError) throw error;
		throw new A2aError(classifyA2aError(error), failureText(error), { cause: error });
	} finally {
		detachAbort?.();
	}
	return {
		task: state.task,
		contextId: state.contextId,
		text: state.text,
		messageText: state.messageText,
		reasoning: state.reasoning,
		artifacts: [...state.artifacts.values()],
		outcome: state.finalOutcome ?? "stream-ended"
	};
}
/**
* Close one stream generator, containing close-time failures.
* @param iterator - the live stream iterator.
*/
async function closeStream(iterator) {
	try {
		await iterator.return(void 0);
	} catch {}
}
/**
* Fold one stream response into the accumulator.
* @param response - one SDK stream response.
* @param state - the mutable accumulator.
*/
function consumeResponse(response, state) {
	const payload = response.payload;
	if (payload === void 0) return;
	switch (payload.$case) {
		case "task": {
			const task = payload.value;
			const outcome = task.status !== void 0 ? classifyTaskState(task.status.state) : "unknown";
			state.task = {
				id: task.id,
				contextId: task.contextId,
				state: outcome
			};
			state.contextId ??= task.contextId;
			for (const artifact of task.artifacts) {
				const projected = projectArtifact(artifact);
				state.artifacts.set(projected.artifactId, projected);
			}
			if (isTerminalOutcome(outcome) || isInterruptedOutcome(outcome)) state.finalOutcome = outcome;
			break;
		}
		case "message":
			harvestMessage(payload.value, state, "message");
			break;
		case "statusUpdate": {
			const update = payload.value;
			const taskStatus = update.status;
			if (taskStatus !== void 0) {
				const outcome = classifyTaskState(taskStatus.state);
				state.task = {
					id: update.taskId,
					contextId: update.contextId,
					state: outcome
				};
				if (isTerminalOutcome(outcome) || isInterruptedOutcome(outcome)) state.finalOutcome = outcome;
				if (taskStatus.message !== void 0) harvestMessage(taskStatus.message, state, "status");
			}
			state.contextId ??= update.contextId;
			break;
		}
		case "artifactUpdate":
			mergeArtifactUpdate(state.artifacts, payload.value);
			break;
	}
}
/**
* Harvest one message's parts into the text and reasoning buffers.
* @param message - the protocol message.
* @param state - the mutable accumulator.
* @param channel - whether the message arrived as a message frame or inside a status update.
*/
function harvestMessage(message, state, channel) {
	const parts = projectMessageParts(message);
	const text = joinPartText(parts);
	state.text += text;
	if (channel === "message") state.messageText += text;
	state.reasoning += joinPartText(parts, { reasoning: true });
	if (message.contextId !== "") state.contextId ??= message.contextId;
}
/**
* Project one fetched task into a snapshot.
* @param task - the protocol task.
* @returns the snapshot with the newest agent message text.
*/
function snapshotOfTask(task) {
	const state = task.status !== void 0 ? classifyTaskState(task.status.state) : "unknown";
	const lastAgent = [...task.history].reverse().find((message) => message.role === Role.ROLE_AGENT && message.parts.length > 0);
	return {
		task: {
			id: task.id,
			contextId: task.contextId,
			state
		},
		artifacts: task.artifacts.map(projectArtifact),
		lastAgentText: lastAgent === void 0 ? "" : joinPartText(projectMessageParts(lastAgent))
	};
}
//#endregion
//#region lib/types/subagent/provider.js
/**
* The A2A subagent provider: bridges one roster agent onto `ctx.subagents`
* as a remote one-shot provider with per-(parent session, agent) A2A
* continuation, ticket refresh on authentication failure, and artifact-aware
* result settlement.
*
* @module dsh-plugin-inkstone/subagent/provider
*/
/** Continuation store keyed by parent session id and agent name. */
var ContinuationStore = class {
	#entries = /* @__PURE__ */ new Map();
	/**
	* Look up the continuation for one pair.
	* @param parentSessionId - the delegating parent's session id.
	* @param agentName - the roster agent name.
	* @returns the recorded context/task ids, or undefined.
	*/
	get(parentSessionId, agentName) {
		return this.#entries.get(`${parentSessionId}/${agentName}`);
	}
	/**
	* Record the continuation after one settled turn.
	* @param parentSessionId - the delegating parent's session id.
	* @param agentName - the roster agent name.
	* @param outcome - the consumed turn outcome.
	*/
	settle(parentSessionId, agentName, outcome) {
		if (outcome.contextId === void 0) return;
		const interrupted = isInterruptedOutcome(outcome.outcome);
		this.#entries.set(`${parentSessionId}/${agentName}`, {
			contextId: outcome.contextId,
			taskId: interrupted ? outcome.task?.id : void 0
		});
	}
	/**
	* Forget one pair's continuation (agent removed or session discarded).
	* @param parentSessionId - the delegating parent's session id.
	* @param agentName - the roster agent name.
	*/
	forget(parentSessionId, agentName) {
		this.#entries.delete(`${parentSessionId}/${agentName}`);
	}
	/** Forget every continuation. */
	clear() {
		this.#entries.clear();
	}
};
/**
* Build one provider for one roster agent.
* @param agent - the roster entry.
* @param headers - the registry service surface for auth headers.
* @param continuations - the shared continuation store.
* @param agentFactory - injectable A2A client factory for tests.
* @returns the provider registered under `a2a/<name>`.
*/
function createA2aProvider(agent, headers, continuations, agentFactory = createA2aAgent) {
	return {
		name: `a2a/${agent.name}`,
		capabilities: {
			agentOptions: false,
			outputSchema: false,
			depthLimit: false,
			toolFilter: false,
			persona: false
		},
		inheritsParentContext: false,
		start(request) {
			return startRun(agent, headers, continuations, agentFactory, request);
		}
	};
}
/**
* Run one delegation turn and settle it as a remote subagent run.
* @param agent - the roster entry.
* @param headers - the registry service surface.
* @param continuations - the shared continuation store.
* @param agentFactory - injectable client factory.
* @param request - the resolved one-shot start request.
* @returns the published remote run.
*/
async function startRun(agent, headers, continuations, agentFactory, request) {
	const runId = brandString(`a2a-${randomUUID()}`);
	const disposal = new AbortController();
	const onCallerAbort = () => {
		disposal.abort();
	};
	request.signal.addEventListener("abort", onCallerAbort, { once: true });
	const client = agentFactory({
		endpointUrl: agent.endpointUrl,
		authHeaders: () => headers.agentHeaders(agent.name, agent.authScheme)
	});
	const objective = promptText(request.prompt);
	const result = (async () => {
		try {
			const parentSessionId = request.parent.session.id;
			const continuation = continuations.get(parentSessionId, agent.name);
			const first = await runTurn(client, objective, disposal.signal, continuation);
			let outcome = first;
			if (needsAuthRetry(first)) {
				headers.invalidateTickets(agent.name);
				outcome = await runTurn(client, objective, disposal.signal, continuation);
			} else if (first.outcome === "stream-ended" && first.task !== void 0) {
				const snapshot = await client.getTask(first.task.id, { signal: disposal.signal });
				outcome = {
					...first,
					outcome: snapshot.task.state
				};
			}
			continuations.settle(parentSessionId, agent.name, outcome);
			return settle(outcome, agent);
		} catch (error) {
			if (request.signal.aborted || disposal.signal.aborted || error instanceof A2aError && error.code === "aborted") return {
				output: [],
				stopReason: "aborted"
			};
			return {
				output: [],
				diagnostic: diagnosticOf(error, agent.name),
				stopReason: "error"
			};
		} finally {
			request.signal.removeEventListener("abort", onCallerAbort);
		}
	})();
	return {
		id: runId,
		localAgent: void 0,
		result,
		async dispose() {
			onCallerAbort();
			await result.catch(
				/* v8 ignore next -- the result contract never rejects */
				() => {}
			);
		}
	};
}
/**
* Run one turn with continuation ids and cancellation.
* @param client - the A2A client.
* @param objective - the delegation text.
* @param signal - disposal-scoped cancellation.
* @param continuation - the recorded continuation, when one exists.
* @returns the consumed turn outcome.
*/
async function runTurn(client, objective, signal, continuation) {
	return await client.runTurn({
		text: objective,
		signal,
		...continuation !== void 0 ? { contextId: continuation.contextId } : {},
		...continuation?.taskId !== void 0 ? { taskId: continuation.taskId } : {}
	});
}
/**
* Whether one outcome warrants one ticket refresh and turn replay.
* @param outcome - the consumed turn outcome.
* @returns true for auth-required interruptions and auth failures.
*/
function needsAuthRetry(outcome) {
	return outcome.outcome === "auth-required";
}
/**
* Project one settled outcome into subagent result content.
* @param outcome - the consumed turn outcome.
* @param agent - the roster entry.
* @returns the settled subagent result.
*/
function settle(outcome, agent) {
	const output = [];
	if (outcome.text !== "") output.push({
		type: "text",
		text: outcome.text
	});
	for (const artifact of outcome.artifacts) {
		const text = artifact.parts.map((part) => part.text).join("");
		if (text !== "") output.push({
			type: "text",
			text
		});
	}
	switch (outcome.outcome) {
		case "completed": return {
			output,
			stopReason: "completed"
		};
		case "input-required": return {
			output,
			stopReason: "completed",
			diagnostic: `remote A2A agent "${agent.name}" requires more input; delegate again with the answer to continue the same task`
		};
		case "auth-required": return {
			output,
			diagnostic: `remote A2A agent "${agent.name}" rejected the refreshed ticket`,
			stopReason: "error"
		};
		case "canceled": return {
			output,
			stopReason: "aborted"
		};
		case "rejected": return {
			output,
			diagnostic: `remote A2A agent "${agent.name}" rejected the task`,
			stopReason: "refusal"
		};
		case "failed": return {
			output,
			diagnostic: `remote A2A agent "${agent.name}" failed the task`,
			stopReason: "error"
		};
		default: return {
			output,
			diagnostic: `remote A2A agent "${agent.name}" ended in state "${outcome.outcome}"`,
			stopReason: "error"
		};
	}
}
/**
* Render one failure into a safe provider diagnostic.
* @param error - the thrown failure.
* @param agentName - the roster agent name.
* @returns a credential-free diagnostic line.
*/
function diagnosticOf(error, agentName) {
	if (error instanceof A2aError) return `remote A2A agent "${agentName}" failed (${error.code}): ${error.message}`;
	let message;
	if (error instanceof Error) message = error.message;
	else message = String(error);
	return `remote A2A agent "${agentName}" failed: ${message}`;
}
/**
* Extract the delegation text from one start request's prompt blocks.
* @param prompt - the prompt content blocks.
* @returns their concatenated text.
*/
function promptText(prompt) {
	let text = "";
	for (const block of prompt) if (block.type === "text") text += block.text;
	return text;
}
//#endregion
//#region lib/types/subagent/tool.js
/**
* The `subagent_a2a` delegation tool: one model-facing tool whose `agent`
* parameter selects among the enabled roster agents, routing through the
* subagent seam's provider registered for that agent.
*
* @module dsh-plugin-inkstone/subagent/tool
*/
/**
* Compose the model-facing tool description from the roster.
* @param agents - the enabled roster agents.
* @returns the description text.
*/
function describeTool(agents) {
	return "Delegate one objective to a remote A2A agent from the agent registry. Each agent is an independent remote service: it does not see this conversation, shares no files or tools, and answers from its own capabilities. Multi-turn agents remember earlier exchanges with you when you delegate to the same agent again. Available agents:\n" + agents.map((agent) => {
		const purpose = agent.description !== "" ? ` — ${agent.description}` : "";
		return `- ${agent.name}${purpose}`;
	}).join("\n");
}
/**
* Register the delegation tool on `ctx.tools`.
* @param ctx - registrant context carrying the subagent and tool services.
* @param agents - the enabled roster agents.
* @param options - tool name and depth cap.
* @returns the registration disposer.
*/
function registerA2aTool(ctx, agents, options) {
	const enabled = agents.filter((agent) => agent.enabled);
	if (enabled.length === 0) {
		const noop = () => {};
		return noop;
	}
	const byName = new Map(enabled.map((agent) => [agent.name, agent]));
	return ctx.tools.register(defineTool({
		name: options.toolName,
		description: describeTool(enabled),
		parameters: {
			agent: {
				type: "string",
				required: true,
				enum: enabled.map((agent) => agent.name),
				description: "The remote A2A agent to delegate to."
			},
			objective: {
				type: "string",
				required: true,
				description: "The complete, self-contained objective for the remote agent, including every fact it cannot see from this conversation."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					agent: {
						type: "string",
						required: true
					},
					text: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.text
			}]
		},
		async execute(args, exec) {
			const agent = byName.get(args.agent);
			/* v8 ignore next 3 -- enum validation makes this unreachable in one composition */
			if (agent === void 0) throw new Error(`unknown A2A agent "${args.agent}"; the roster changed while this tool was visible`);
			if (exec.agent === void 0) throw new Error("A2A delegation requires an owning agent session");
			const depth = delegationDepthOf(exec.agent);
			if (depth >= options.maxDepth) throw new Error(`A2A delegation refused at depth ${depth} (cap ${options.maxDepth})`);
			const prompt = [{
				type: "text",
				text: args.objective
			}];
			const run = await ctx.subagents.start(`a2a/${agent.name}`, {
				prompt,
				parent: exec.agent,
				signal: exec.signal,
				label: `a2a/${agent.name}`
			});
			try {
				const result = await run.result;
				let text = "";
				for (const block of result.output) if (block.type === "text") text += block.text;
				if (result.stopReason !== "completed") {
					let diagnostic = "";
					if (result.diagnostic !== void 0) diagnostic = ` (${result.diagnostic})`;
					throw new Error(`A2A agent "${args.agent}" ended with ${result.stopReason}${diagnostic}`);
				}
				if (text === "" && result.diagnostic !== void 0) text = result.diagnostic;
				return {
					agent: args.agent,
					text
				};
			} finally {
				await run.dispose();
			}
		},
		presentCall: (args) => ({
			card: "generic",
			title: `Delegate to ${args.agent} (remote A2A)`,
			kind: "other",
			rawInput: args.objective
		})
	}));
}
//#endregion
//#region lib/types/scphub/error.js
/**
* SCP Hub failure vocabulary: one error class whose code names the failing
* stage, mirroring the registry client's `RegistryError` conventions.
*
* @module dsh-plugin-inkstone/scphub/error
*/
/** One SCP Hub client failure. */
var ScpHubError = class extends Error {
	/** Machine-readable stage that failed. */
	code;
	/**
	* @param code - failing stage.
	* @param message - credential-free diagnostic text.
	*/
	constructor(code, message) {
		super(message);
		this.name = "ScpHubError";
		this.code = code;
	}
};
//#endregion
//#region lib/types/scphub/credential.js
/**
* SCP Hub execution credential: an API key exchanged for the OpenXLab SSO
* bearer through the moce `/apikey` endpoints. The key outlives the JWT, so
* it is cached in the credential store (scope: environment + sso uid) and
* re-requested only after its service-reported expiry, mirroring the
* registry client's STS ticket lifecycle.
*
* @module dsh-plugin-inkstone/scphub/credential
*/
/** Store keys the API key record lives under, one per environment. */
const KEY = {
	staging: credentialKey("scp-hub", "staging"),
	production: credentialKey("scp-hub", "production")
};
/** Parse one `"YYYY-MM-DD HH:mm:ss"` Shanghai timestamp into epoch ms. */
function shanghaiTimestampMs(value) {
	const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
	if (match === null) return NaN;
	const [, year, month, day, hour, minute, second] = match;
	return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 8, Number(minute), Number(second));
}
/** The API key name this client requests, dated in Asia/Shanghai. */
function automaticApiKeyName(now) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "2-digit",
		month: "2-digit",
		day: "2-digit"
	}).formatToParts(now);
	const read = (type) => parts.find((part) => part.type === type)?.value ?? "";
	return `dsh-inkstone-client-${read("year")}${read("month")}${read("day")}`;
}
/**
* One row of the `/apikey/list` response, strictly validated; malformed rows
* throw so a silent upstream shape change never yields a bogus credential.
*/
function apiKeyRowOf(value) {
	if (value === null || typeof value !== "object") throw new ScpHubError("invalid-response", "SCP Hub API key row is malformed");
	const record = value;
	const id = String(record.id ?? "");
	const name = typeof record.name === "string" ? record.name : "";
	const key = typeof record.key === "string" ? record.key : "";
	const status = typeof record.status === "string" ? record.status : "";
	const createdAtMs = typeof record.created_at === "string" ? shanghaiTimestampMs(record.created_at) : NaN;
	const expiresAtMs = typeof record.expires_at === "string" ? shanghaiTimestampMs(record.expires_at) : NaN;
	if (id === "" || name === "" || key.length < 8 || key.length > 8 * 1024 || /[\s\u0000-\u001f\u007f]/.test(key) || !Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs)) throw new ScpHubError("invalid-response", "SCP Hub API key row is malformed");
	return {
		id,
		name,
		key,
		status,
		createdAtMs,
		expiresAtMs
	};
}
const RENEW_MARGIN_MS = 6e4;
/**
* The SCP Hub API-key exchange: find an active key with this client's name,
* creating one when none exists, and keep the winner in the credential store.
*/
var ScpHubApiKey = class {
	#options;
	#store;
	#pending;
	/**
	* @param store - credential store for the persisted grant.
	* @param options - endpoints, identity supplier, and test hooks.
	*/
	constructor(store, options) {
		this.#store = store;
		this.#options = options;
	}
	/**
	* The API key value, exchanging or renewing when the cached grant expired.
	* @returns the `SCP-HUB-API-KEY` value.
	*/
	async apiKey() {
		const cached = await this.#readStored();
		const now = this.#options.now?.() ?? /* @__PURE__ */ new Date();
		if (cached !== void 0 && cached.expiresAtMs > now.getTime() + RENEW_MARGIN_MS) return cached.apiKey;
		this.#pending ??= this.#exchange().finally(() => {
			this.#pending = void 0;
		});
		return await this.#pending;
	}
	/** Forget the cached grant; the next call exchanges a new key. */
	invalidate() {
		this.#pending = void 0;
		this.#store.deleteRecord(KEY[this.#options.environment]);
	}
	async #readStored() {
		const record = await this.#store.readRecord(KEY[this.#options.environment]);
		if (record === void 0 || record.kind !== "grant") return;
		const payload = record.payload;
		if (payload === null || typeof payload !== "object") return;
		const id = typeof payload.id === "string" ? payload.id : "";
		const apiKey = typeof payload.apiKey === "string" ? payload.apiKey : "";
		const expiresAtMs = typeof payload.expiresAtMs === "number" ? payload.expiresAtMs : 0;
		if (id === "" || apiKey === "" || !Number.isFinite(expiresAtMs)) return;
		return {
			id,
			apiKey,
			expiresAtMs
		};
	}
	async #exchange() {
		const name = automaticApiKeyName(this.#options.now?.() ?? /* @__PURE__ */ new Date());
		let rows = await this.#list(name);
		if (rows.length === 0) {
			await this.#create(name);
			rows = await this.#list(name);
		}
		const winner = [...rows].sort((left, right) => right.createdAtMs - left.createdAtMs)[0];
		if (winner === void 0) throw new ScpHubError("api-key-unavailable", "SCP Hub did not provide an API key");
		await this.#store.modifyRecord(KEY[this.#options.environment], async () => ({
			kind: "grant",
			payload: {
				id: winner.id,
				apiKey: winner.key,
				expiresAtMs: winner.expiresAtMs
			}
		}));
		return winner.key;
	}
	async #list(name) {
		const matched = [];
		let pages = 1;
		for (let page = 0; page < pages; page += 1) {
			const envelope = await this.#request(`/apikey/list?page=${page}&page_size=100`, void 0);
			const list = envelope?.list;
			if (!Array.isArray(list)) throw new ScpHubError("invalid-response", "SCP Hub API key list is malformed");
			if (page === 0) {
				const reported = typeof envelope?.pages === "number" && Number.isInteger(envelope.pages) ? envelope.pages : 1;
				pages = Math.min(Math.max(reported, 1), 100);
			}
			const now = this.#options.now?.() ?? /* @__PURE__ */ new Date();
			for (const row of list.map(apiKeyRowOf)) if (row.name === name && row.status === "active" && row.expiresAtMs > now.getTime()) matched.push(row);
		}
		return matched;
	}
	async #create(name) {
		await this.#request("/apikey/create", { name });
	}
	async #request(path, body) {
		const { bearer } = await this.#options.identity();
		const response = await (this.#options.fetchImpl ?? fetch)(`${this.#options.apiBaseUrl}${path}`, {
			method: body === void 0 ? "GET" : "POST",
			headers: {
				accept: "application/json",
				authorization: `Bearer ${bearer}`,
				...body === void 0 ? {} : { "content-type": "application/json" }
			},
			...body === void 0 ? {} : { body: JSON.stringify(body) },
			redirect: "error"
		});
		if (response.status === 401 || response.status === 403) throw new ScpHubError("sso-rejected", "SCP Hub rejected the SSO bearer");
		if (!response.ok) throw new ScpHubError("hub-rejected", `SCP Hub returned HTTP ${response.status}`);
		const envelope = await response.json().catch(() => {
			throw new ScpHubError("invalid-response", "SCP Hub returned a non-JSON body");
		});
		const code = String(envelope.code ?? "");
		if (!(envelope.success === true || envelope.success !== false && (code === "0" || code === "10000"))) throw new ScpHubError("hub-rejected", envelope.msg ?? "SCP Hub returned an error envelope");
		return envelope.data ?? Object.create(null);
	}
};
//#endregion
//#region lib/types/scphub/client.js
/**
* Read-only SCP Hub directory client: catalog search, SCP detail with tool
* inventory, and skill detail with signed download locations. Every response
* is strictly validated; failures surface as {@link ScpHubError}.
*
* @module dsh-plugin-inkstone/scphub/client
*/
const DESCRIPTION_MAX_BYTES = 4096;
const NAME_MAX_BYTES = 256;
function boundedText(value, label, maxBytes) {
	if (typeof value !== "string") throw new ScpHubError("invalid-response", `SCP Hub ${label} is malformed`);
	if (Buffer.byteLength(value, "utf8") > maxBytes) throw new ScpHubError("invalid-response", `SCP Hub ${label} exceeds its bound`);
	return value;
}
function countOf(value) {
	return Number(value) || 0;
}
function stringId(value) {
	return String(value ?? "");
}
function tagNames(value) {
	if (!Array.isArray(value)) return [];
	const names = [];
	for (const tag of value) if (tag !== null && typeof tag === "object") {
		const name = tag.name;
		if (typeof name === "string" && name !== "") names.push(name);
	} else if (typeof tag === "string" && tag !== "") names.push(tag);
	return names.slice(0, 16);
}
/**
* The SCP Hub directory client.
*/
var ScpHubClient = class {
	#options;
	/**
	* @param options - API base, bearer supplier, and test fetch hook.
	*/
	constructor(options) {
		this.#options = options;
	}
	/**
	* Search the catalog for SCP services or skills.
	* @param type - which resource kind to list.
	* @param options - keyword, tag filter, and pagination.
	* @returns one page of catalog hits.
	*/
	async search(type, options = {}) {
		const params = new URLSearchParams({
			page: String(options.page ?? 0),
			page_size: String(options.pageSize ?? 20),
			types: type
		});
		const keyword = options.keyword?.trim() ?? "";
		if (keyword !== "") params.set("keyword", keyword);
		const data = await this.#requestJson(`/scphub/v1/search/query?${params.toString()}`);
		const list = data.list;
		if (!Array.isArray(list)) throw new ScpHubError("invalid-response", "SCP Hub search response is malformed");
		const items = list.map((item) => this.#catalogItem(item, type));
		return {
			total: countOf(type === "skill" ? data.skill_total ?? data.total : data.scp_total ?? data.total),
			page: options.page ?? 0,
			pageSize: options.pageSize ?? 20,
			items
		};
	}
	/**
	* Full detail for one SCP server, including its tool inventory.
	* @param id - catalog server id.
	* @returns the validated detail.
	*/
	async scpDetail(id) {
		const [detailData, toolsData] = await Promise.all([this.#requestJson(`/scphub/v1/scp/details?server_ids=${encodeURIComponent(id)}`), this.#requestJson(`/scphub/v1/scp/tools/list?server_id=${encodeURIComponent(id)}`)]);
		const row = (Array.isArray(detailData.list) ? detailData.list : []).find((candidate) => stringId(candidate?.id) === id);
		if (row === null || row === void 0) throw new ScpHubError("invalid-response", `SCP Hub has no SCP ${id}`);
		const record = row;
		const endpoint = typeof record.endpoint === "string" ? record.endpoint.trim() : "";
		if (endpoint === "") throw new ScpHubError("invalid-response", `SCP ${id} publishes no endpoint`);
		const tools = (Array.isArray(toolsData.list) ? toolsData.list : []).map((tool) => {
			const rowTool = tool;
			return {
				name: boundedText(rowTool.name, "tool name", NAME_MAX_BYTES),
				description: boundedText(rowTool.description ?? rowTool.title ?? "", "tool description", DESCRIPTION_MAX_BYTES)
			};
		});
		return {
			id,
			name: boundedText(record.server_name, "SCP name", NAME_MAX_BYTES),
			description: boundedText(record.brief_description_zh ?? record.brief_description_en ?? record.brief_description ?? "", "SCP description", DESCRIPTION_MAX_BYTES),
			publisher: typeof record.publisher === "string" ? record.publisher : "",
			endpoint,
			offline: record.status === "offline",
			tools
		};
	}
	/**
	* Full detail for one skill, including its signed download locations.
	* @param id - catalog skill id.
	* @returns the validated detail.
	*/
	async skillDetail(id) {
		const data = await this.#requestJson(`/scphub/v1/skill/details?server_ids=${encodeURIComponent(id)}`);
		const row = (Array.isArray(data.list) ? data.list : []).find((candidate) => stringId(candidate?.id) === id);
		if (row === null || row === void 0) throw new ScpHubError("invalid-response", `SCP Hub has no skill ${id}`);
		const record = row;
		const bodyUrl = typeof record.skill_md_signed_url === "string" ? record.skill_md_signed_url.trim() : "";
		if (bodyUrl === "") throw new ScpHubError("skill-unavailable", `Skill ${id} publishes no body`);
		const toolkitUrl = typeof record.toolkit_signed_url === "string" && record.toolkit_signed_url.trim() !== "" ? record.toolkit_signed_url.trim() : void 0;
		return {
			id,
			name: boundedText(record.skill_name ?? record.name, "skill name", NAME_MAX_BYTES),
			description: boundedText(record.brief_description_zh ?? record.brief_description_en ?? record.brief_description ?? "", "skill description", DESCRIPTION_MAX_BYTES),
			publisher: typeof record.publisher === "string" ? record.publisher : "",
			offline: record.status === "offline",
			bodyUrl,
			toolkitUrl
		};
	}
	/**
	* Download one signed resource (skill body or toolkit) without credentials.
	* @param url - the signed URL from a detail response.
	* @param maxBytes - response size bound.
	* @returns the raw bytes.
	*/
	async download(url, maxBytes) {
		const baseFetch = this.#options.fetchImpl ?? fetch;
		let response;
		try {
			response = await baseFetch(url, {
				headers: { accept: "application/octet-stream, application/zip, text/markdown" },
				redirect: "error"
			});
		} catch (error) {
			throw new ScpHubError("hub-unreachable", `SCP Hub resource download failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (!response.ok) throw new ScpHubError("hub-rejected", `SCP Hub resource download returned HTTP ${response.status}`);
		const buffer = new Uint8Array(await response.arrayBuffer());
		if (buffer.byteLength > maxBytes) throw new ScpHubError("invalid-response", "SCP Hub resource exceeds its size bound");
		return buffer;
	}
	#catalogItem(value, type) {
		if (value === null || typeof value !== "object") throw new ScpHubError("invalid-response", "SCP Hub catalog row is malformed");
		const record = value;
		const scpExt = record.scp_ext;
		const skillExt = record.skill_ext;
		return {
			id: stringId(record.id),
			type,
			name: boundedText(record.name, "catalog name", NAME_MAX_BYTES),
			description: boundedText(record.brief_description_zh ?? record.brief_description ?? "", "catalog description", DESCRIPTION_MAX_BYTES),
			publisher: typeof record.publisher === "string" ? record.publisher : "",
			tags: [...tagNames(record.tags), ...tagNames(record.custom_tags)],
			official: record.is_official === true,
			viewCount: countOf(record.stats?.view_count),
			downloadCount: countOf(skillExt?.download_count ?? record.download_count),
			invocationCount: countOf(scpExt?.invocation_count ?? record.invocation_count),
			toolsCount: scpExt?.tools_count !== void 0 ? countOf(scpExt.tools_count) : void 0
		};
	}
	async #requestJson(path) {
		const bearer = await this.#options.bearer();
		const baseFetch = this.#options.fetchImpl ?? fetch;
		let response;
		try {
			response = await baseFetch(`${this.#options.apiBaseUrl}${path}`, {
				headers: {
					accept: "application/json",
					authorization: `Bearer ${bearer}`
				},
				redirect: "error"
			});
		} catch (error) {
			throw new ScpHubError("hub-unreachable", `SCP Hub request failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (response.status === 401 || response.status === 403) throw new ScpHubError("sso-rejected", "SCP Hub rejected the SSO bearer");
		if (!response.ok) throw new ScpHubError("hub-rejected", `SCP Hub returned HTTP ${response.status}`);
		const envelope = await response.json().catch(() => {
			throw new ScpHubError("invalid-response", "SCP Hub returned a non-JSON body");
		});
		const code = String(envelope.code ?? "");
		if (!(envelope.success === true || envelope.success !== false && (code === "0" || code === "10000"))) throw new ScpHubError("hub-rejected", envelope.msg ?? "SCP Hub returned an error envelope");
		return envelope.data ?? Object.create(null);
	}
};
//#endregion
//#region lib/types/scphub/service.js
/**
* The host-side SCP Hub service (`ctx.scpHub`): owns the API-key exchange and
* exposes read-only catalog operations plus skill archive materialization.
* Local add/remove persistence belongs to the plugin Config, not this service.
*
* @module dsh-plugin-inkstone/scphub/service
*/
/** Deployment endpoints for the SCP Hub, keyed by environment. */
const SCP_HUB_DEPLOYMENTS = {
	staging: {
		apiBaseUrl: "https://discovery-staging.intern-ai.org.cn/api",
		apiKeyBaseUrl: "https://discovery-staging.intern-ai.org.cn/api/moce/v1"
	},
	production: {
		apiBaseUrl: "https://discovery.intern-ai.org.cn/api",
		apiKeyBaseUrl: "https://discovery.intern-ai.org.cn/api/moce/v1"
	}
};
/**
* The SCP Hub client core: API-key exchange and read-only catalog operations
* in a plain class, safe for private members because every caller invokes it
* on the raw instance (`service.core`), never through the context's tracing
* proxy.
*/
var ScpHubCore = class {
	#client;
	#apiKey;
	/**
	* @param store - the credentials store for the execution API key.
	* @param identity - the shared OpenXLab SSO identity (from `ctx.a2aRegistry`).
	* @param config - endpoints and test hooks.
	*/
	constructor(store, identity, config) {
		this.#apiKey = new ScpHubApiKey(store, {
			apiBaseUrl: config.apiKeyBaseUrl,
			environment: config.environment,
			...config.fetchImpl !== void 0 ? { fetchImpl: config.fetchImpl } : {},
			identity: async () => identity()
		});
		this.#client = new ScpHubClient({
			apiBaseUrl: config.apiBaseUrl,
			bearer: () => identity().then((current) => current.bearer),
			...config.fetchImpl !== void 0 ? { fetchImpl: config.fetchImpl } : {}
		});
	}
	/**
	* The execution credential for MCP calls into SCP servers.
	* @returns the `SCP-HUB-API-KEY` value.
	*/
	apiKey() {
		return this.#apiKey.apiKey();
	}
	/**
	* Forget the cached API key; the next call exchanges a new one.
	*/
	invalidateApiKey() {
		this.#apiKey.invalidate();
	}
	/**
	* Search the catalog.
	* @param type - resource kind.
	* @param options - keyword and pagination.
	* @returns one catalog page.
	*/
	search(type, options) {
		return this.#client.search(type, options);
	}
	/**
	* Full detail for one SCP server.
	* @param id - catalog server id.
	* @returns the detail with its tool inventory.
	*/
	scpDetail(id) {
		return this.#client.scpDetail(id);
	}
	/**
	* Full detail for one skill.
	* @param id - catalog skill id.
	* @returns the detail with signed download locations.
	*/
	skillDetail(id) {
		return this.#client.skillDetail(id);
	}
	/**
	* Materialize one skill: body plus optional toolkit archive bytes.
	* @param id - catalog skill id.
	* @param maxToolkitBytes - size bound for the toolkit archive.
	* @returns the SKILL.md text and, when published, the archive bytes.
	*/
	async skillArchive(id, maxToolkitBytes) {
		const detail = await this.#client.skillDetail(id);
		if (detail.offline) throw new ScpHubError("skill-unavailable", `Skill ${id} is offline`);
		const body = await this.#client.download(detail.bodyUrl, 1024 * 1024);
		const toolkit = detail.toolkitUrl === void 0 ? void 0 : await this.#client.download(detail.toolkitUrl, maxToolkitBytes);
		return {
			name: detail.name,
			description: detail.description,
			content: Buffer.from(body).toString("utf8"),
			toolkit
		};
	}
};
/**
* The SCP Hub host service (`ctx.scpHub`). A thin shell over
* {@link ScpHubCore}: the context's tracing proxy serves `ctx.scpHub` method
* calls with the proxy as receiver, where private members of this class would
* be inaccessible — the public `core` field keeps every call on the raw core.
*/
var ScpHubService = class extends Service {
	static inject = ["credentials"];
	/** The client core this shell exposes; public for tracing-proxy access. */
	core;
	/**
	* @param ctx - providing context carrying the credentials store.
	* @param identity - the shared OpenXLab SSO identity (from `ctx.a2aRegistry`).
	* @param config - endpoints and test hooks.
	*/
	constructor(ctx, identity, config) {
		super(ctx, "scpHub");
		const store = {
			readRecord: (key) => ctx.credentials.readRecord(key),
			modifyRecord: (key, produce) => ctx.credentials.modifyRecord(key, produce),
			deleteRecord: (key) => ctx.credentials.deleteRecord(key)
		};
		this.core = new ScpHubCore(store, identity, config);
	}
	/**
	* The execution credential for MCP calls into SCP servers.
	* @returns the `SCP-HUB-API-KEY` value.
	*/
	apiKey() {
		return this.core.apiKey();
	}
	/** Forget the cached API key; the next call exchanges a new one. */
	invalidateApiKey() {
		this.core.invalidateApiKey();
	}
	/**
	* Search the catalog.
	* @param type - resource kind.
	* @param options - keyword and pagination.
	* @returns one catalog page.
	*/
	search(type, options) {
		return this.core.search(type, options);
	}
	/**
	* Full detail for one SCP server.
	* @param id - catalog server id.
	* @returns the detail with its tool inventory.
	*/
	scpDetail(id) {
		return this.core.scpDetail(id);
	}
	/**
	* Full detail for one skill.
	* @param id - catalog skill id.
	* @returns the detail with signed download locations.
	*/
	skillDetail(id) {
		return this.core.skillDetail(id);
	}
	/**
	* Materialize one skill: body plus optional toolkit archive bytes.
	* @param id - catalog skill id.
	* @param maxToolkitBytes - size bound for the toolkit archive.
	* @returns the SKILL.md text and, when published, the archive bytes.
	*/
	skillArchive(id, maxToolkitBytes) {
		return this.core.skillArchive(id, maxToolkitBytes);
	}
};
//#endregion
//#region lib/types/scphub/mcp.js
/**
* Minimal stateless JSON-RPC client for the SCP Hub execution plane. The
* execution endpoints answer every request independently (no session is
* issued), so listing and calling need no persistent connection: each call is
* one POST with the execution API key and the negotiated protocol version.
*
* @module dsh-plugin-inkstone/scphub/mcp
*/
/** Protocol revision this client advertises on every request. */
const PROTOCOL_VERSION = "2025-03-26";
/** Default per-request deadline. */
const REQUEST_TIMEOUT_MS = 3e4;
/**
* POST one JSON-RPC request and return its `result` object.
* @param endpoint - the SCP's MCP endpoint URL.
* @param apiKey - the `SCP-HUB-API-KEY` value.
* @param method - JSON-RPC method name.
* @param params - JSON-RPC params; the execution plane rejects an omitted
* params member, so callers always pass an object (possibly empty).
* @param fetchImpl - injectable fetch for tests.
* @param signal - cooperative cancellation; a deadline is layered on top.
* @returns the response `result`.
* @throws Error carrying the JSON-RPC error or HTTP failure.
*/
async function rpc(endpoint, apiKey, method, params, fetchImpl, signal) {
	const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	const response = await fetchImpl(endpoint, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"SCP-HUB-API-KEY": apiKey,
			"MCP-Protocol-Version": PROTOCOL_VERSION
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method,
			params
		}),
		signal: signal === void 0 ? deadline : AbortSignal.any([signal, deadline]),
		redirect: "error"
	});
	if (!response.ok) throw new Error(`SCP ${method} returned HTTP ${response.status}`);
	const envelope = await parseEnvelope(response);
	if (envelope.error !== void 0) {
		const message = typeof envelope.error.message === "string" ? envelope.error.message : "unknown error";
		throw new Error(`SCP ${method} failed: ${message} (${String(envelope.error.code)})`);
	}
	if (envelope.result === void 0) throw new Error(`SCP ${method} returned no result`);
	return envelope.result;
}
/**
* Decode one JSON-RPC response body. The execution plane answers with plain
* JSON; a `text/event-stream` body is accepted by joining its `data:` lines,
* so servers that stream notifications stay readable.
* @param response - the fetched response.
* @returns the parsed envelope object.
*/
async function parseEnvelope(response) {
	const text = await response.text();
	const body = (response.headers.get("content-type") ?? "").includes("text/event-stream") ? text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("") : text;
	try {
		return JSON.parse(body);
	} catch {
		throw new Error("SCP returned a non-JSON body");
	}
}
/**
* List every tool an SCP server exposes.
* @param endpoint - the SCP's MCP endpoint URL.
* @param apiKey - the `SCP-HUB-API-KEY` value.
* @param fetchImpl - injectable fetch for tests; defaults to global fetch.
* @returns the validated tool specs.
* @throws when the response is malformed or the request fails.
*/
async function listScpTools(endpoint, apiKey, fetchImpl = fetch) {
	const tools = (await rpc(endpoint, apiKey, "tools/list", {}, fetchImpl)).tools;
	if (!Array.isArray(tools)) throw new Error("SCP tools/list response is malformed");
	const specs = [];
	for (const tool of tools) {
		if (tool === null || typeof tool !== "object") throw new Error("SCP tools/list response is malformed");
		const record = tool;
		const name = typeof record.name === "string" ? record.name : "";
		if (name === "") throw new Error("SCP tools/list response is malformed");
		specs.push({
			name,
			description: typeof record.description === "string" ? record.description : "",
			inputSchema: typeof record.inputSchema === "object" && record.inputSchema !== null ? record.inputSchema : { type: "object" },
			...record.outputSchema !== void 0 ? { outputSchema: record.outputSchema } : {}
		});
	}
	return specs;
}
/**
* Call one tool on an SCP server.
* @param endpoint - the SCP's MCP endpoint URL.
* @param apiKey - the `SCP-HUB-API-KEY` value.
* @param rawName - the upstream tool name.
* @param args - the model arguments.
* @param fetchImpl - injectable fetch for tests; defaults to global fetch.
* @param signal - cooperative cancellation from the tool runtime.
* @returns the raw MCP `CallToolResult` object.
*/
async function callScpTool(endpoint, apiKey, rawName, args, fetchImpl = fetch, signal) {
	return await rpc(endpoint, apiKey, "tools/call", {
		name: rawName,
		arguments: args
	}, fetchImpl, signal);
}
//#endregion
//#region lib/types/scphub/tools-bridge.js
/**
* Selective tool bridge: register ONLY the tools the user picked for one SCP
* server. Discovery (`tools/list`) runs once per mount; every registered tool
* forwards execution to the stateless execution plane (`tools/call`) with the
* caller's cancellation layered on a request deadline. Result projection
* (text join, structured content, durable image admission) mirrors the
* harness mcp-client bridge so model-facing behavior stays consistent.
*
* @module dsh-plugin-inkstone/scphub/tools-bridge
*/
/** DeepSeek function-name contract: at most 64 characters. */
const MAX_PUBLIC_NAME_LENGTH = 64;
/** DeepSeek function-name contract: only `[A-Za-z0-9_-]` is allowed. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g;
/** Hex chars of the SHA-256 identity hash appended on lossy normalization. */
const HASH_LENGTH = 12;
/** Raster formats supported by the durable attachment vocabulary. */
const IMAGE_MEDIA_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif"
];
/** Canonical RFC 4648 base64, excluding whitespace and URL-safe aliases. */
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/**
* Derive the model-facing public name for one MCP tool, mirroring the harness
* naming contract: `mcp__<serverName>__<rawName>` verbatim when it already
* satisfies the function-name rules; otherwise normalized with a 12-hex-char
* SHA-256 identity suffix so distinct tools never collapse.
* @param serverName - stable local namespace from the local entry.
* @param rawName - the SCP server's own tool name.
* @returns the model-facing tool name.
*/
function publicToolName(serverName, rawName) {
	const joined = `mcp__${serverName}__${rawName}`;
	const normalized = joined.replace(INVALID_NAME_CHARS, "_");
	if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized;
	const hash = createHash("sha256").update(`${serverName}\0${rawName}`).digest("hex").slice(0, HASH_LENGTH);
	return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`;
}
/**
* Discover one SCP's tools and register only the selected ones.
* @param ctx - plugin context carrying the tools registry and optional
* attachment/llm services for image admission.
* @param options - endpoint, namespace, selection, key supplier, hooks.
* @returns disposer unregistering everything this call registered.
* @throws when discovery fails; nothing is registered in that case.
*/
async function registerScpTools(ctx, options) {
	const apiKey = await options.apiKey();
	const specs = await listScpTools(options.endpoint, apiKey, options.fetchImpl ?? fetch);
	const byName = new Map(specs.map((spec) => [spec.name, spec]));
	const disposers = [];
	try {
		for (const rawName of new Set(options.selectedTools)) {
			const spec = byName.get(rawName);
			if (spec === void 0) {
				options.onMissingTool(rawName);
				continue;
			}
			disposers.push(ctx.tools.register(scpToolDefinition(ctx, options, spec)));
		}
	} catch (error) {
		for (const dispose of disposers.splice(0)) dispose();
		throw error;
	}
	return () => {
		for (const dispose of disposers.splice(0)) dispose();
	};
}
/**
* Build one registered tool definition from an upstream spec.
* @param ctx - plugin context for optional image admission services.
* @param options - mount options (endpoint, namespace, key supplier).
* @param spec - the upstream tool as `tools/list` reported it.
* @returns the unregistered ToolRuntime definition.
*/
function scpToolDefinition(ctx, options, spec) {
	const projections = /* @__PURE__ */ new WeakMap();
	return {
		name: publicToolName(options.serverName, spec.name),
		description: spec.description,
		parameters: spec.inputSchema,
		output: createOutput(spec.name, supportedOutputSchema(spec.outputSchema)),
		execute: createExecutor(ctx, options, spec, projections),
		projectContent(exec, result) {
			const projection = projections.get(exec);
			if (projection === void 0) return void 0;
			projections.delete(exec);
			if (result.isError) return void 0;
			if (!isDeepStrictEqual(result.value, projection.value)) return void 0;
			if (!isDeepStrictEqual(result.content, projection.fallback)) return void 0;
			return projection.content;
		}
	};
}
/** Build the canonical result schema and the Native text projection. */
function createOutput(rawName, structuredSchema) {
	return {
		schema: {
			type: "object",
			properties: {
				content: {
					type: "array",
					items: {}
				},
				structuredContent: structuredSchema ?? {}
			},
			required: structuredSchema === void 0 ? ["content"] : ["content", "structuredContent"],
			additionalProperties: false
		},
		render(_args, value) {
			return [{
				type: "text",
				text: extractText(value.content, rawName)
			}];
		}
	};
}
/** Keep a supported advertised schema; unsupported MCP vocabulary falls back to JsonValue. */
function supportedOutputSchema(candidate) {
	if (candidate === void 0) return void 0;
	try {
		assertSupportedJsonSchema(candidate);
		return candidate;
	} catch {
		return;
	}
}
/**
* Invoke the execution plane and prepare canonical content. MCP `isError`
* results reject before image storage so ToolRuntime records failure.
*/
function createExecutor(ctx, options, spec, projections) {
	const { name: rawName } = spec;
	return async (args, exec) => {
		const argsObj = typeof args === "object" && args !== null ? args : {};
		const raw = await callScpTool(options.endpoint, await options.apiKey(), rawName, argsObj, options.fetchImpl ?? fetch, exec.signal);
		const content = Array.isArray(raw.content) ? raw.content : [];
		const text = extractText(content, rawName);
		if (raw.isError === true) throw new Error(text);
		const value = {
			content,
			...raw.structuredContent !== void 0 ? { structuredContent: raw.structuredContent } : {}
		};
		if (containsImage(content)) {
			const fallback = [{
				type: "text",
				text: extractText(content, rawName)
			}];
			const projected = await prepareImageProjection(ctx, exec, content, rawName);
			projections.set(exec, {
				value,
				fallback,
				content: projected
			});
		}
		return value;
	};
}
/** Whether an untrusted MCP content array contains a declared image block. */
function containsImage(content) {
	return content.some((value) => isRecord(value) && value.type === "image");
}
/** Narrow one JSON value to a string-keyed object. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Narrow a declared MIME string to the durable image vocabulary. */
function isImageMediaType(value) {
	return IMAGE_MEDIA_TYPES.includes(value);
}
/** Decode one projected image without accepting base64 aliases. */
function decodeImage(block) {
	if (!isImageMediaType(block.mimeType ?? "")) throw new Error("the declared media type is not PNG, JPEG, WebP, or GIF");
	if (typeof block.data !== "string" || !CANONICAL_BASE64.test(block.data)) throw new Error("the image data is not canonical base64");
	const data = Buffer.from(block.data, "base64");
	if (data.toString("base64") !== block.data) throw new Error("the image data is not canonical base64");
	return {
		data,
		mediaType: block.mimeType
	};
}
/**
* Resolve the active model route and durable store for an image-bearing result.
* @param ctx - plugin context with optional attachment and llm services.
* @param exec - exact tool execution whose agent supplies the latest route.
* @returns the attachment store after exact positive image-capability proof.
*/
async function resolveImageAdmission(ctx, exec) {
	const attachments = ctx.get("attachments");
	if (attachments === void 0) throw new Error("no attachment store is mounted");
	const routed = exec.agent?.session.requestHeader()?.config;
	const provider = routed?.provider ?? exec.agent?.options.provider;
	const model = routed?.model ?? exec.agent?.options.model;
	const llm = ctx.get("llm");
	if (provider === void 0 || model === void 0 || llm === void 0) throw new Error("the current model route could not be resolved");
	let info;
	try {
		info = await llm.resolveModelInfo(provider, model, exec.signal);
	} catch {
		throw new Error("the current model route could not be verified");
	}
	if (info.inputModalities === void 0 || !info.inputModalities.includes("image")) throw new Error(`model "${model}" does not declare image input`);
	if (exec.signal.aborted) throw new Error("the tool call was canceled before image storage");
	return attachments;
}
/** Stable diagnostic text for an image block that was not admitted. */
function imageDiagnostic(block, reason) {
	return `[image unavailable: ${block.mimeType ?? "unknown media type"}; ${reason}; raw image data remains available to programmatic callers]`;
}
/**
* Decode, preflight, and durably save one MCP result's ordered image batch.
* Any refusal projects every image as text while retaining the canonical raw
* value for programmatic callers.
*/
async function prepareImageProjection(ctx, exec, content, toolName) {
	const decoded = [];
	const validationErrors = /* @__PURE__ */ new Map();
	const imageIndexes = [];
	for (const [index, value] of content.entries()) {
		if (!isRecord(value) || value.type !== "image") continue;
		imageIndexes.push(index);
		try {
			decoded.push(decodeImage(value));
		} catch (error) {
			validationErrors.set(index, error.message);
		}
	}
	if (validationErrors.size > 0) return projectContent(content, toolName, (block, index) => ({
		type: "text",
		text: imageDiagnostic(block, validationErrors.get(index) ?? "another image in the same result was invalid")
	}));
	let attachments;
	try {
		attachments = await resolveImageAdmission(ctx, exec);
	} catch (error) {
		const reason = error.message;
		return projectContent(content, toolName, (block) => ({
			type: "text",
			text: imageDiagnostic(block, reason)
		}));
	}
	try {
		const refs = await attachments.saveImages(decoded);
		const byIndex = new Map(imageIndexes.map((index, offset) => [index, refs[offset]]));
		return projectContent(content, toolName, (_block, index) => ({
			type: "image",
			attachment: byIndex.get(index)
		}));
	} catch (error) {
		const reason = isImageAdmissionError(error) ? `image admission rejected the result: ${error.message}` : "durable image storage rejected the result";
		return projectContent(content, toolName, (block) => ({
			type: "text",
			text: imageDiagnostic(block, reason)
		}));
	}
}
/**
* Extract text from an MCP content array into a single string: text blocks
* join with '\n'; image/audio/resource blocks become placeholders.
*/
function extractText(mcpContent, toolName) {
	return projectContent(mcpContent, toolName).map((block) => block.text).join("\n");
}
/**
* Project ordered MCP blocks into the core content vocabulary. Text-like runs
* are newline-coalesced; admitted images split those runs at their position.
*/
function projectContent(mcpContent, toolName, image = (block) => ({
	type: "text",
	text: imageDiagnostic(block, "this result was not admitted to durable model context")
})) {
	const projected = [];
	const text = [];
	const flushText = () => {
		if (text.length === 0) return;
		projected.push({
			type: "text",
			text: text.splice(0).join("\n")
		});
	};
	for (const [index, value] of mcpContent.entries()) {
		if (!isRecord(value)) {
			text.push("[unsupported MCP content block: expected an object]");
			continue;
		}
		const block = value;
		switch (block.type) {
			case "text":
				if (block.text !== void 0) text.push(block.text);
				break;
			case "image":
				flushText();
				projected.push(image(block, index));
				break;
			case "resource_link":
				if (block.name === void 0 || block.uri === void 0) text.push("[resource link unavailable: the MCP block is missing its name or URI]");
				else text.push(`Resource link: ${block.name} (${block.uri})`);
				break;
			case "audio":
				text.push(`[audio result unsupported: ${block.mimeType ?? "unknown media type"}; raw audio data remains available to programmatic callers]`);
				break;
			case "resource":
				text.push("[embedded resource unsupported; raw resource data remains available to programmatic callers]");
				break;
			default: text.push(`[unsupported MCP content type: ${block.type}]`);
		}
	}
	flushText();
	return projected.length > 0 ? projected : [{
		type: "text",
		text: `(${toolName} returned no model-visible content)`
	}];
}
//#endregion
//#region lib/types/skills/install.js
/**
* Skill archive materialization: unpack the SCP Hub toolkit zip and install
* `SKILL.md` plus resources atomically under the plugin's skills root. The
* zip reader walks the central directory; deflate streams go through
* `node:zlib` (with a hard output cap) instead of a hand-rolled inflater.
*
* @module dsh-plugin-inkstone/skills/install
*/
const EOCD_MIN_BYTES = 22;
/** The default install root: `~/.dsh/inkstone/skills`. */
function defaultSkillsRoot() {
	return join(homedir(), ".dsh", "inkstone", "skills");
}
/**
* Read one zip archive's stored (method 0) and deflated (method 8) entries.
* @param archive - the raw zip bytes.
* @param limits - entry count and total size bounds (uncompressed bytes).
* @returns the files whose paths are safe relative paths.
* @throws when the archive is malformed or exceeds its bounds.
*/
function readSkillArchive(archive, limits) {
	let eocd = -1;
	for (let cursor = archive.byteLength - EOCD_MIN_BYTES; cursor >= Math.max(0, archive.byteLength - 66e3); cursor -= 1) if (archive[cursor] === 80 && archive[cursor + 1] === 75 && archive[cursor + 2] === 5 && archive[cursor + 3] === 6) {
		eocd = cursor;
		break;
	}
	if (eocd < 0) throw new Error("skill archive has no central directory");
	const entryCount = archive[eocd + 10] | archive[eocd + 11] << 8;
	if (entryCount > limits.maxEntries) throw new Error("skill archive exceeds its entry bound");
	const directoryOffset = archive[eocd + 16] | archive[eocd + 17] << 8 | archive[eocd + 18] << 16 | archive[eocd + 19] << 24;
	const files = [];
	let total = 0;
	let cursor = directoryOffset;
	for (let index = 0; index < entryCount; index += 1) {
		if (cursor + 46 > archive.byteLength || archive[cursor] !== 80 || archive[cursor + 1] !== 75) throw new Error("skill archive central directory is malformed");
		const method = archive[cursor + 10] | archive[cursor + 11] << 8;
		const compressedSize = archive[cursor + 20] | archive[cursor + 21] << 8 | archive[cursor + 22] << 16 | archive[cursor + 23] << 24;
		const uncompressedSize = archive[cursor + 24] | archive[cursor + 25] << 8 | archive[cursor + 26] << 16 | archive[cursor + 27] << 24;
		const nameLength = archive[cursor + 28] | archive[cursor + 29] << 8;
		const extraLength = archive[cursor + 30] | archive[cursor + 31] << 8;
		const commentLength = archive[cursor + 32] | archive[cursor + 33] << 8;
		const localOffset = archive[cursor + 42] | archive[cursor + 43] << 8 | archive[cursor + 44] << 16 | archive[cursor + 45] << 24;
		const nameStart = cursor + 46;
		const name = Buffer.from(archive.subarray(nameStart, nameStart + nameLength)).toString("utf8");
		cursor = nameStart + nameLength + extraLength + commentLength;
		if (name.endsWith("/") || name === "" || name.includes("\\") || name.startsWith("/") || name.split("/").includes("..")) continue;
		if (method !== 0 && method !== 8) continue;
		if (compressedSize === 4294967295 || uncompressedSize === 4294967295 || localOffset === 4294967295) throw new Error("skill archive uses unsupported zip64 entries");
		if (localOffset + 30 > archive.byteLength || archive[localOffset] !== 80 || archive[localOffset + 1] !== 75) throw new Error("skill archive local header is malformed");
		total += uncompressedSize;
		if (total > limits.maxTotalBytes) throw new Error("skill archive exceeds its size bound");
		const localNameLength = archive[localOffset + 26] | archive[localOffset + 27] << 8;
		const localExtraLength = archive[localOffset + 28] | archive[localOffset + 29] << 8;
		const dataStart = localOffset + 30 + localNameLength + localExtraLength;
		const raw = archive.subarray(dataStart, dataStart + compressedSize);
		let bytes;
		if (method === 0) bytes = raw;
		else {
			try {
				bytes = new Uint8Array(inflateRawSync(Buffer.from(raw), { maxOutputLength: limits.maxTotalBytes }));
			} catch {
				throw new Error("skill archive deflate stream is malformed");
			}
			if (bytes.byteLength !== uncompressedSize) throw new Error("skill archive entry size mismatch");
		}
		files.push({
			path: name,
			bytes
		});
	}
	return files;
}
/**
* Read one installed skill's body and resources.
* @param root - the skills root directory.
* @param directoryName - the skill's directory under the root.
* @returns the SKILL.md text and resource files; undefined when absent.
*/
async function readInstalledSkill(root, directoryName) {
	const directory = join(root, directoryName);
	try {
		const content = await readFile(join(directory, "SKILL.md"), "utf8");
		const resources = [];
		await collectFiles(directory, directory, "", resources);
		return {
			content,
			resources: resources.filter((file) => file.path !== "SKILL.md")
		};
	} catch {
		return;
	}
}
/**
* Install one skill atomically: staging directory, then a single rename.
* @param root - the skills root directory.
* @param directoryName - the target directory under the root.
* @param content - the SKILL.md text.
* @param resources - the archive resources (SKILL.md itself is ignored here).
* @returns the installed directory path.
*/
async function installSkill(root, directoryName, content, resources) {
	await mkdir(root, {
		recursive: true,
		mode: 448
	});
	const staging = join(root, `.install-${randomUUID()}`);
	await mkdir(staging, { mode: 448 });
	let committed = false;
	try {
		await writeFile(join(staging, "SKILL.md"), content, {
			flag: "wx",
			mode: 384
		});
		for (const resource of resources) {
			if (resource.path === "SKILL.md") continue;
			const destination = join(staging, ...resource.path.split("/"));
			if (!destination.startsWith(staging + "/")) throw new Error("skill resource escaped staging");
			await mkdir(dirname(destination), {
				recursive: true,
				mode: 448
			});
			await writeFile(destination, resource.bytes, {
				flag: "wx",
				mode: 384
			});
		}
		const retired = join(root, `.retired-${randomUUID()}`);
		const target = join(root, directoryName);
		await rm(retired, {
			recursive: true,
			force: true
		});
		await rename(target, retired).catch(() => {});
		await rename(staging, target);
		committed = true;
		await rm(retired, {
			recursive: true,
			force: true
		});
		return target;
	} finally {
		if (!committed) await rm(staging, {
			recursive: true,
			force: true
		}).catch(() => {});
	}
}
/**
* Remove one installed skill directory.
* @param root - the skills root directory.
* @param directoryName - the skill's directory under the root.
*/
async function removeSkill(root, directoryName) {
	await rm(join(root, directoryName), {
		recursive: true,
		force: true
	}).catch(() => {});
}
async function collectFiles(root, directory, prefix, files) {
	const entries = await readdir(directory, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name.startsWith(".install-") || entry.name.startsWith(".retired-")) continue;
		const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
		if (entry.isDirectory()) await collectFiles(root, join(directory, entry.name), path, files);
		else if (entry.isFile()) files.push({
			path,
			bytes: new Uint8Array(await readFile(join(directory, entry.name)))
		});
	}
}
//#endregion
//#region lib/types/scphub/mirror.js
/**
* The SCP Hub runtime mirror: the user-selected tools of every enabled SCP
* server registered on `ctx.tools` through the selective bridge (authorized
* with the SCP Hub API key), plus one runtime skill per enabled installed
* skill. Rebuilt whenever the volatile `scps`/`skills` config changes,
* mirroring the delegation roster's lifecycle.
*
* @module dsh-plugin-inkstone/scphub/mirror
*/
/** Server-name characters the public tool-name contract accepts. */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
/** Skill names `ctx.skills` accepts. */
const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/;
/**
* Normalize one catalog name into a `ctx.skills` name.
* @param name - display name from the catalog.
* @param id - catalog id, used as the fallback stem.
* @returns the kebab-case skill name.
*/
function skillNameOf(name, id) {
	const kebab = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
	if (SKILL_NAME.test(kebab)) return kebab;
	return `scp-skill-${id}`;
}
/**
* Normalize one local entry into a tool-namespace server name.
* @param scp - the local entry.
* @returns the server name behind `mcp__<name>__*` tool prefixes.
*/
function serverNameOf(scp) {
	const candidate = scp.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
	if (SERVER_NAME.test(candidate)) return candidate;
	return `scp-${scp.id}`.slice(0, 32);
}
/** Directory name for one installed skill. */
function skillDirectoryName(id) {
	return `scp-${id}`;
}
/**
* (Re)build the SCP Hub mirror under one plugin context.
* @param ctx - the mirror child plugin's context.
* @param options - service, rosters, and install root.
* @returns the dispose function tearing the mirror down.
*/
function rebuildScpHubMirror(ctx, options) {
	const teardown = [];
	let disposed = false;
	const track = (dispose) => {
		if (disposed) {
			try {
				dispose();
			} catch {}
			return;
		}
		teardown.push(dispose);
	};
	(async () => {
		let budget = options.maxSelectedTools;
		const mounted = options.scps.filter((entry) => entry.enabled && entry.selectedTools.length > 0).slice(0, options.maxToolServers);
		for (const scp of mounted) {
			if (disposed) return;
			let selected = [...new Set(scp.selectedTools)];
			if (selected.length > budget) {
				ctx.logger.warn(`inkstone: SCP server "${scp.name}" truncated to ${String(budget)} tools (maxSelectedTools)`);
				selected = selected.slice(0, Math.max(budget, 0));
			}
			budget -= selected.length;
			try {
				const dispose = await registerScpTools(ctx, {
					endpoint: scp.endpoint,
					serverName: serverNameOf(scp),
					selectedTools: selected,
					apiKey: () => options.scpHub.apiKey(),
					onMissingTool: (rawName) => ctx.logger.warn(`inkstone: SCP server "${scp.name}" no longer lists tool "${rawName}"; remove it from the selection`),
					...options.fetchImpl !== void 0 ? { fetchImpl: options.fetchImpl } : {}
				});
				track(dispose);
			} catch (error) {
				ctx.logger.warn(`inkstone: SCP server "${scp.name}" failed to mount: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	})();
	for (const skill of options.skills.filter((entry) => entry.enabled)) (async () => {
		const installed = await readInstalledSkill(options.skillsRoot, skillDirectoryName(skill.id));
		if (installed === void 0) {
			ctx.logger.warn(`inkstone: skill "${skill.name}" is enabled but not installed; re-add it from the catalog`);
			return;
		}
		if (disposed) return;
		track(ctx.skills.register({
			name: skill.skillName,
			description: skill.description,
			content: installed.content,
			source: "runtime"
		}));
	})();
	return () => {
		disposed = true;
		for (const dispose of teardown.splice(0)) try {
			dispose();
		} catch {}
	};
}
/**
* Install one skill from its archive material and return the local entry.
* @param skillsRoot - the install root.
* @param id - catalog id.
* @param name - display name.
* @param description - catalog description; doubles as routing description.
* @param content - the SKILL.md text.
* @param toolkit - optional archive bytes.
* @param limits - unpack bounds.
* @returns the persisted local entry.
*/
async function installLocalSkill(skillsRoot, id, name, description, content, toolkit, limits) {
	const resources = toolkit === void 0 ? [] : readSkillArchive(toolkit, limits);
	await installSkill(skillsRoot, skillDirectoryName(id), content, resources);
	return {
		id,
		skillName: skillNameOf(name, id),
		name,
		description,
		enabled: true
	};
}
/**
* Remove one installed skill's directory; config removal is the caller's.
* @param skillsRoot - the install root.
* @param id - catalog id.
*/
async function uninstallLocalSkill(skillsRoot, id) {
	await removeSkill(skillsRoot, skillDirectoryName(id));
}
//#endregion
//#region lib/types/scphub/remote.js
/**
* Remote owner of the `scpHub` namespace over the host SCP Hub service:
* catalog search, detail reads, and the execution API key. The API key never
* crosses to the browser in listings — only `apiKeyHeaders` for MCP mounts,
* which the host itself performs.
*
* @module dsh-plugin-inkstone/scphub/remote
*/
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
		else descriptor[key] = _;
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
/** Project one catalog hit onto its wire view. */
function itemView(item) {
	return {
		id: item.id,
		type: item.type,
		name: item.name,
		description: item.description,
		publisher: item.publisher,
		tags: item.tags,
		official: item.official,
		viewCount: item.viewCount,
		downloadCount: item.downloadCount,
		invocationCount: item.invocationCount,
		toolsCount: item.toolsCount ?? null
	};
}
/** Project one page onto its wire view. */
function pageView(page) {
	return {
		total: page.total,
		page: page.page,
		pageSize: page.pageSize,
		items: page.items.map(itemView)
	};
}
/** Project one SCP detail onto its wire view. */
function scpView(detail) {
	return {
		id: detail.id,
		name: detail.name,
		description: detail.description,
		publisher: detail.publisher,
		endpoint: detail.endpoint,
		offline: detail.offline,
		tools: detail.tools.map((tool) => ({
			name: tool.name,
			description: tool.description
		}))
	};
}
/** Project one skill detail onto its wire view. */
function skillView(detail) {
	return {
		id: detail.id,
		name: detail.name,
		description: detail.description,
		publisher: detail.publisher,
		offline: detail.offline,
		hasToolkit: detail.toolkitUrl !== void 0
	};
}
/** Classify one service failure as a Remote failure. */
function remoteFailure(error) {
	if (error instanceof RemoteError) return error;
	const reason = error instanceof Error ? error.message : String(error);
	return new RemoteError("scphub/unavailable", reason, { reason });
}
let ScpHubController = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _search_decorators;
	let _scpDetail_decorators;
	let _skillDetail_decorators;
	let _addScp_decorators;
	let _installSkill_decorators;
	let _removeSkill_decorators;
	return class ScpHubController extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_search_decorators = [Remote];
			_scpDetail_decorators = [Remote];
			_skillDetail_decorators = [Remote];
			_addScp_decorators = [Remote];
			_installSkill_decorators = [Remote];
			_removeSkill_decorators = [Remote];
			__esDecorate(this, null, _search_decorators, {
				kind: "method",
				name: "search",
				static: false,
				private: false,
				access: {
					has: (obj) => "search" in obj,
					get: (obj) => obj.search
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _scpDetail_decorators, {
				kind: "method",
				name: "scpDetail",
				static: false,
				private: false,
				access: {
					has: (obj) => "scpDetail" in obj,
					get: (obj) => obj.scpDetail
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _skillDetail_decorators, {
				kind: "method",
				name: "skillDetail",
				static: false,
				private: false,
				access: {
					has: (obj) => "skillDetail" in obj,
					get: (obj) => obj.skillDetail
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _addScp_decorators, {
				kind: "method",
				name: "addScp",
				static: false,
				private: false,
				access: {
					has: (obj) => "addScp" in obj,
					get: (obj) => obj.addScp
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _installSkill_decorators, {
				kind: "method",
				name: "installSkill",
				static: false,
				private: false,
				access: {
					has: (obj) => "installSkill" in obj,
					get: (obj) => obj.installSkill
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _removeSkill_decorators, {
				kind: "method",
				name: "removeSkill",
				static: false,
				private: false,
				access: {
					has: (obj) => "removeSkill" in obj,
					get: (obj) => obj.removeSkill
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		static inject = ["scpHub"];
		/** Install options; public because Remote dispatch invokes through the
		* context's tracing proxy, where private members are inaccessible. */
		options = __runInitializers(this, _instanceExtraInitializers);
		/**
		* @param ctx - Host context where the SCP Hub service is mounted.
		* @param options - install root and unpack bounds.
		*/
		constructor(ctx, options) {
			super(ctx, "scpHubController", { namespace: "scpHub" });
			this.options = options;
		}
		/**
		* Search the catalog for SCP services or skills.
		* @param type - resource kind.
		* @param keyword - optional search text.
		* @param page - zero-based page index.
		* @param signal - client cancellation.
		* @returns one catalog page.
		*/
		async search(type, keyword, page, signal) {
			try {
				signal.throwIfAborted();
				const options = { page };
				if (keyword !== null && keyword !== "") options.keyword = keyword;
				return pageView(await this.ctx.scpHub.search(type, options));
			} catch (error) {
				throw remoteFailure(error);
			}
		}
		/**
		* Full detail for one SCP server.
		* @param id - catalog server id.
		* @param signal - client cancellation.
		* @returns the detail with its tool inventory.
		*/
		async scpDetail(id, signal) {
			try {
				signal.throwIfAborted();
				return scpView(await this.ctx.scpHub.scpDetail(id));
			} catch (error) {
				throw remoteFailure(error);
			}
		}
		/**
		* Full detail for one skill.
		* @param id - catalog skill id.
		* @param signal - client cancellation.
		* @returns the detail (without signed URLs).
		*/
		async skillDetail(id, signal) {
			try {
				signal.throwIfAborted();
				return skillView(await this.ctx.scpHub.skillDetail(id));
			} catch (error) {
				throw remoteFailure(error);
			}
		}
		/**
		* Resolve one SCP server's detail for local addition; the caller persists
		* the returned facts into its own config.
		* @param id - catalog server id.
		* @param signal - client cancellation.
		* @returns the detail with its tool inventory.
		*/
		async addScp(id, signal) {
			try {
				signal.throwIfAborted();
				return scpView(await this.ctx.scpHub.scpDetail(id));
			} catch (error) {
				throw remoteFailure(error);
			}
		}
		/**
		* Download, unpack, and install one skill; the caller persists the returned
		* entry into its own config.
		* @param id - catalog skill id.
		* @param signal - client cancellation.
		* @returns the installed local-entry facts.
		*/
		async installSkill(id, signal) {
			try {
				signal.throwIfAborted();
				const archive = await this.ctx.scpHub.skillArchive(id, this.options.maxToolkitBytes);
				const local = await installLocalSkill(this.options.skillsRoot, id, archive.name, archive.description, archive.content, archive.toolkit, {
					maxEntries: this.options.maxToolkitEntries,
					maxTotalBytes: this.options.maxToolkitBytes
				});
				return {
					id: local.id,
					skillName: local.skillName,
					name: local.name,
					description: local.description
				};
			} catch (error) {
				throw remoteFailure(error);
			}
		}
		/**
		* Remove one installed skill's directory; the caller removes its config row.
		* @param id - catalog skill id.
		* @param signal - client cancellation.
		*/
		async removeSkill(id, signal) {
			try {
				signal.throwIfAborted();
				await uninstallLocalSkill(this.options.skillsRoot, id);
			} catch (error) {
				throw remoteFailure(error);
			}
		}
	};
})();
//#endregion
//#region lib/types/index.js
/**
* 端砚 (Inkstone): DeepSeek Harness 插件 —— agent-registry + SCP Hub 集成。
* One host plugin mounts the whole stack in order: the `ctx.a2aRegistry`
* service (OpenXLab SSO, STS exchange, MCP directory), the `ctx.scpHub`
* service (catalog search, API-key exchange), both Remote controllers for
* browser settings, the delegation mirror (one remote provider plus the
* `subagent_a2a` tool per enabled roster agent), and the SCP Hub mirror
* (one mcp-client child per enabled SCP server, one runtime skill per
* enabled installed skill) — the mirrors rebuild on volatile updates.
*
* @module dsh-plugin-inkstone
*/
/** Cordis plugin name. */
const name = "inkstone";
/** Services required before the plugin activates. */
const inject = ["credentials"];
const agentSchema = z.object({
	name: z.string().required(),
	endpointUrl: z.string().required(),
	authScheme: z.union([
		"none",
		"apiKey",
		"http",
		"oauth2",
		"openIdConnect",
		"token_exchange",
		"orbit_jwt"
	]).required(),
	description: z.string().default(""),
	enabled: z.boolean().default(true)
});
const scpSchema = z.object({
	id: z.string().required(),
	name: z.string().required(),
	description: z.string().default(""),
	publisher: z.string().default(""),
	endpoint: z.string().required(),
	enabled: z.boolean().default(true),
	selectedTools: z.array(z.string()).default([]),
	toolNames: z.array(z.string()).default([])
});
const skillSchema = z.object({
	id: z.string().required(),
	skillName: z.string().required(),
	name: z.string().required(),
	description: z.string().default(""),
	enabled: z.boolean().default(true)
});
const Config = z.object({
	registryBaseUrl: z.string().default("https://agent-registry-staging.intern-ai.org.cn"),
	ssoBaseUrl: z.string().default(OPENXLAB_DEFAULT_BASE_URL),
	scpHubApiBaseUrl: z.string().default(SCP_HUB_DEPLOYMENTS.staging.apiBaseUrl),
	scpHubApiKeyBaseUrl: z.string().default(SCP_HUB_DEPLOYMENTS.staging.apiKeyBaseUrl),
	scpHubEnvironment: z.union(["staging", "production"]).default("staging"),
	agents: z.array(agentSchema).volatile().default([]),
	scps: z.array(scpSchema).volatile().default([]),
	skills: z.array(skillSchema).volatile().default([]),
	toolName: z.string().default("subagent_a2a"),
	maxDepth: z.number().step(1).min(0).default(1),
	skillsRoot: z.string().default(defaultSkillsRoot()),
	maxToolServers: z.number().step(1).min(1).max(32).default(8),
	maxSelectedTools: z.number().step(1).min(1).max(1024).default(128)
});
/**
* Mount the registry service, the Remote controller, and the delegation mirror.
* The mirror is its own child plugin: it injects `a2aRegistry` (provided by the
* service mounted just above), because a context that did not declare an
* inject cannot read the service off itself.
* @param ctx - registrant context carrying the credentials store.
* @param config - deployment configuration with the volatile roster.
*/
function apply(ctx, config) {
	ctx.plugin(A2aRegistryService, {
		registryBaseUrl: config.registryBaseUrl,
		ssoBaseUrl: config.ssoBaseUrl
	});
	ctx.plugin({
		name: "inkstone-scp-hub-service",
		inject: ["credentials", "a2aRegistry"],
		apply(sctx) {
			new ScpHubService(sctx, () => sctx.a2aRegistry.identity(), {
				apiBaseUrl: config.scpHubApiBaseUrl,
				apiKeyBaseUrl: config.scpHubApiKeyBaseUrl,
				environment: config.scpHubEnvironment
			});
		}
	});
	ctx.plugin(A2aRegistryController);
	ctx.plugin(ScpHubController, {
		skillsRoot: config.skillsRoot,
		maxToolkitEntries: 512,
		maxToolkitBytes: 32 * 1024 * 1024
	});
	ctx.plugin({
		name: "inkstone-scp-hub",
		inject: [
			"scpHub",
			"skills",
			"tools"
		],
		apply(mirror) {
			let disposeMirror;
			const rebuild = () => {
				disposeMirror?.();
				disposeMirror = rebuildScpHubMirror(mirror, {
					scpHub: mirror.scpHub,
					scps: config.scps.get(),
					skills: config.skills.get(),
					skillsRoot: config.skillsRoot,
					maxToolServers: config.maxToolServers,
					maxSelectedTools: config.maxSelectedTools
				});
			};
			rebuild();
			mirror.on("loader/volatile-update", rebuild);
			mirror.effect(() => () => {
				disposeMirror?.();
			});
		}
	});
	ctx.plugin({
		name: "inkstone-delegation",
		inject: [
			"a2aRegistry",
			"subagents",
			"tools"
		],
		apply(mirror) {
			const continuations = new ContinuationStore();
			let disposeMirrors;
			const rebuild = () => {
				disposeMirrors?.();
				const agents = config.agents.get();
				const disposers = [];
				for (const agent of agents.filter((entry) => entry.enabled)) disposers.push(mirror.subagents.registerProvider(createA2aProvider(agent, mirror.a2aRegistry, continuations)));
				disposers.push(registerA2aTool(mirror, agents, {
					toolName: config.toolName,
					maxDepth: config.maxDepth
				}));
				disposeMirrors = () => {
					for (const dispose of disposers.splice(0)) dispose();
				};
			};
			rebuild();
			mirror.on("loader/volatile-update", rebuild);
			mirror.effect(() => () => {
				disposeMirrors?.();
				continuations.clear();
			});
		}
	});
}
//#endregion
export { A2aError, Config, ContinuationStore, OPENXLAB_DEFAULT_BASE_URL, OpenXLabSso, RegistryClientCore, RegistryDirectory, RegistryError, SCP_HUB_DEPLOYMENTS, ScpHubApiKey, ScpHubClient, ScpHubError, StsExchange, apply, classifyA2aError, createA2aAgent, createA2aProvider, defaultSkillsRoot, describeTool, inject, installSkill, name, readSkillArchive, registerA2aTool };

//# sourceMappingURL=index.js.map