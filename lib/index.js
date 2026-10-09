import z from "@deepseek-ai/schemastery";
import { createHmac, randomUUID } from "node:crypto";
import { Service } from "@deepseek-ai/cordis";
import { credentialKey } from "@deepseek-ai/dsh-credentials";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Remote, RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { brandString } from "@deepseek-ai/dsh-brand";
import { AgentCard, GetTaskRequest, Role, SendMessageRequest, TaskState } from "@a2a-js/sdk";
import { isIP } from "node:net";
import { ClientFactory, JsonRpcTransportFactory, RestTransportFactory } from "@a2a-js/sdk/client";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { delegationDepthOf } from "@deepseek-ai/dsh-subagent";
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
function remoteFailure(error) {
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
			__esDecorate(this, null, _status_decorators, {
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
			__esDecorate(this, null, _login_decorators, {
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
			__esDecorate(this, null, _logout_decorators, {
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
			__esDecorate(this, null, _discover_decorators, {
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
			__runInitializers(this, _instanceExtraInitializers);
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
				throw remoteFailure(error);
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
				throw remoteFailure(error);
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
//#region lib/types/index.js
/**
* 端砚 (Inkstone): DeepSeek Harness 插件 —— agent-registry 集成。
* One host plugin mounts the whole stack in order: the `ctx.a2aRegistry`
* service (OpenXLab SSO, STS exchange, MCP directory), the `a2aRegistry`
* Remote controller for browser settings, and the delegation mirror (one
* remote provider plus the `subagent_a2a` tool per enabled roster agent),
* rebuilt whenever the volatile roster changes.
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
const Config = z.object({
	registryBaseUrl: z.string().default("https://agent-registry-staging.intern-ai.org.cn"),
	ssoBaseUrl: z.string().default(OPENXLAB_DEFAULT_BASE_URL),
	agents: z.array(agentSchema).volatile().default([]),
	toolName: z.string().default("subagent_a2a"),
	maxDepth: z.number().step(1).min(0).default(1)
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
	ctx.plugin(A2aRegistryController);
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
export { A2aError, Config, ContinuationStore, OPENXLAB_DEFAULT_BASE_URL, OpenXLabSso, RegistryClientCore, RegistryDirectory, RegistryError, StsExchange, apply, classifyA2aError, createA2aAgent, createA2aProvider, describeTool, inject, name, registerA2aTool };

//# sourceMappingURL=index.js.map